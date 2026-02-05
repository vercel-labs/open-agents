import { z } from "zod";
import { connectSandbox } from "@open-harness/sandbox";
import { generateText, gateway, NoObjectGeneratedError, Output } from "ai";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

const prContentSchema = z.object({
  title: z.string().describe("A concise PR title, max 72 characters"),
  body: z
    .string()
    .describe(
      "A markdown PR body with: brief summary of changes, list of key changes as bullet points, and notes for reviewers if applicable",
    ),
});

function generateBranchName(username: string, name?: string | null): string {
  let initials = "nb";
  if (name) {
    initials =
      name
        .split(" ")
        .map((part) => part[0]?.toLowerCase() ?? "")
        .join("")
        .slice(0, 2) || "nb";
  } else if (username) {
    initials = username.slice(0, 2).toLowerCase();
  }
  const randomSuffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${initials}/${randomSuffix}`;
}

/**
 * Detects if a string looks like a git commit hash (detached HEAD state).
 * Git short hashes are 7+ hex chars, full hashes are 40.
 */
function looksLikeCommitHash(str: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(str);
}

// Allow up to 2 minutes for AI generation and git operations
export const maxDuration = 120;

interface GeneratePRRequest {
  sessionId: string;
  sessionTitle: string;
  baseBranch: string;
  branchName: string;
  createBranchOnly?: boolean;
  commitOnly?: boolean;
}

export async function POST(req: Request) {
  // 1. Validate session
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  // 2. Parse request
  let body: GeneratePRRequest;
  try {
    body = (await req.json()) as GeneratePRRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    sessionId,
    sessionTitle,
    baseBranch,
    branchName,
    createBranchOnly,
    commitOnly,
  } = body;

  if (!sessionId) {
    return Response.json({ error: "Session ID is required" }, { status: 400 });
  }

  // Verify session ownership
  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (sessionRecord.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isSandboxActive(sessionRecord.sandboxState)) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  if (!branchName) {
    return Response.json({ error: "Branch name is required" }, { status: 400 });
  }

  if (!baseBranch) {
    return Response.json({ error: "Base branch is required" }, { status: 400 });
  }

  // Validate baseBranch to prevent command injection
  const safeBranchPattern = /^[\w\-/.]+$/;
  if (!safeBranchPattern.test(baseBranch)) {
    return Response.json(
      { error: "Invalid base branch name" },
      { status: 400 },
    );
  }

  // 3. Connect to sandbox
  const sandbox = await connectSandbox(sessionRecord.sandboxState);
  const cwd = sandbox.workingDirectory;

  // 3a. Resolve live branch from sandbox
  let resolvedBranch = branchName === "HEAD" ? baseBranch : branchName;
  const branchResult = await sandbox.exec(
    "git symbolic-ref --short HEAD",
    cwd,
    10000,
  );
  const liveBranch = branchResult.stdout.trim();
  if (branchResult.success && liveBranch && liveBranch !== "HEAD") {
    resolvedBranch = liveBranch;
  }

  // 3b. Fetch latest from origin to ensure we have up-to-date refs
  // Explicitly fetch the base branch to ensure we have the ref
  const fetchResult = await sandbox.exec(
    `git fetch origin ${baseBranch}:refs/remotes/origin/${baseBranch}`,
    cwd,
    30000,
  );
  console.log(
    `[generate-pr] Fetch result: success=${fetchResult.success}, stdout=${fetchResult.stdout.trim()}, stderr=${fetchResult.stderr?.trim() ?? ""}`,
  );

  // 3c. Check for uncommitted changes
  const statusResult = await sandbox.exec("git status --porcelain", cwd, 10000);
  const hasUncommittedChanges = statusResult.stdout.trim().length > 0;

  // Debug: log initial state
  console.log(
    `[generate-pr] Initial state - branch: ${resolvedBranch}, baseBranch: ${baseBranch}, uncommitted: ${hasUncommittedChanges}`,
  );
  console.log(`[generate-pr] Status output: "${statusResult.stdout.trim()}"`);

  // 3d. Determine baseRef - prefer origin/<base> for accurate comparison
  // Try multiple methods to find the remote base ref
  let baseRef = baseBranch;

  // Method 1: Check if origin/<base> exists via rev-parse (more reliable than show-ref)
  const originRefCheck = await sandbox.exec(
    `git rev-parse --verify origin/${baseBranch}`,
    cwd,
    10000,
  );
  if (originRefCheck.success && originRefCheck.stdout.trim()) {
    baseRef = `origin/${baseBranch}`;
    console.log(
      `[generate-pr] Found origin/${baseBranch} at ${originRefCheck.stdout.trim().slice(0, 8)}`,
    );
  } else {
    // Method 2: Check if local base branch exists
    const localRefCheck = await sandbox.exec(
      `git rev-parse --verify ${baseBranch}`,
      cwd,
      10000,
    );
    if (localRefCheck.success && localRefCheck.stdout.trim()) {
      baseRef = baseBranch;
      console.log(
        `[generate-pr] Found local ${baseBranch} at ${localRefCheck.stdout.trim().slice(0, 8)}`,
      );
    } else {
      // Method 3: List available remote refs for debugging
      const refsResult = await sandbox.exec(
        "git for-each-ref --format='%(refname:short)' refs/remotes/origin/",
        cwd,
        10000,
      );
      console.log(
        `[generate-pr] Available remote refs: ${refsResult.stdout.trim() || "none"}`,
      );

      // Method 4: Try to use FETCH_HEAD as last resort (points to what was just fetched)
      const fetchHeadCheck = await sandbox.exec(
        "git rev-parse FETCH_HEAD",
        cwd,
        10000,
      );
      if (fetchHeadCheck.success && fetchHeadCheck.stdout.trim()) {
        baseRef = "FETCH_HEAD";
        console.log(
          `[generate-pr] Using FETCH_HEAD as base: ${fetchHeadCheck.stdout.trim().slice(0, 8)}`,
        );
      } else {
        console.log(
          `[generate-pr] WARNING: Could not find base ref ${baseBranch} locally or on origin`,
        );
      }
    }
  }
  console.log(`[generate-pr] Using baseRef: ${baseRef}`);

  const commitsAheadResult = await sandbox.exec(
    `git rev-list ${baseRef}..HEAD`,
    cwd,
    10000,
  );
  const hasCommitsAhead = commitsAheadResult.stdout.trim().length > 0;
  console.log(
    `[generate-pr] Commits ahead of ${baseRef}: ${commitsAheadResult.stdout.trim() || "none"}`,
  );

  // Need to create branch if on base branch OR if branch name looks like a commit hash (detached HEAD)
  const isDetachedOrOnBase =
    resolvedBranch === baseBranch || looksLikeCommitHash(resolvedBranch);

  console.log(
    `[generate-pr] isDetachedOrOnBase: ${isDetachedOrOnBase} (resolved: ${resolvedBranch}, base: ${baseBranch})`,
  );

  const shouldCreateBranch =
    isDetachedOrOnBase &&
    (createBranchOnly || hasUncommittedChanges || hasCommitsAhead);

  if (shouldCreateBranch) {
    const generatedBranch = generateBranchName(
      session.user.username,
      session.user.name,
    );
    const checkoutResult = await sandbox.exec(
      `git checkout -b ${generatedBranch}`,
      cwd,
      10000,
    );
    if (!checkoutResult.success) {
      return Response.json(
        {
          error: `Failed to create branch: ${checkoutResult.stdout}`,
        },
        { status: 500 },
      );
    }
    resolvedBranch = generatedBranch;
  }

  if (!safeBranchPattern.test(resolvedBranch)) {
    return Response.json({ error: "Invalid branch name" }, { status: 400 });
  }

  if (resolvedBranch !== branchName) {
    await updateSession(sessionId, { branch: resolvedBranch }).catch(
      (error) => {
        console.error("Failed to update session branch:", error);
      },
    );
  }

  if (createBranchOnly) {
    return Response.json({ branchName: resolvedBranch });
  }

  const gitActions: {
    committed?: boolean;
    commitMessage?: string;
    pushed?: boolean;
  } = {};

  if (hasUncommittedChanges) {
    // 4a. Get diff for commit message generation
    const diffResult = await sandbox.exec("git diff HEAD", cwd, 30000);
    const stagedDiffResult = await sandbox.exec(
      "git diff --cached",
      cwd,
      30000,
    );
    const diffForCommit = diffResult.stdout + stagedDiffResult.stdout;

    // 4b. Stage all changes
    const addResult = await sandbox.exec("git add -A", cwd, 10000);
    if (!addResult.success) {
      return Response.json(
        { error: "Failed to stage changes" },
        { status: 500 },
      );
    }

    // 4c. Generate commit message with AI
    const commitMsgResult = await generateText({
      model: gateway("anthropic/claude-haiku-4.5"),
      prompt: `Generate a concise git commit message for these changes. Use conventional commit format (e.g., "feat:", "fix:", "refactor:"). One line only, max 72 characters.

Session context: ${sessionTitle}

Diff:
${diffForCommit.slice(0, 8000)}

Respond with ONLY the commit message, nothing else.`,
    });

    const commitMessage = commitMsgResult.text.trim();

    // 4d. Create commit (escape shell special characters in message)
    // Using single quotes is safest, but we need to handle single quotes in the message
    // by ending the quote, adding an escaped single quote, and starting a new quote
    const escapedMessage = commitMessage.replace(/'/g, "'\\''");
    const commitResult = await sandbox.exec(
      `git commit -m '${escapedMessage}'`,
      cwd,
      10000,
    );

    if (!commitResult.success) {
      return Response.json(
        { error: `Failed to commit: ${commitResult.stdout}` },
        { status: 500 },
      );
    }

    console.log(`[generate-pr] Committed successfully: ${commitMessage}`);
    const postCommitHead = await sandbox.exec("git rev-parse HEAD", cwd, 5000);
    console.log(
      `[generate-pr] HEAD after commit: ${postCommitHead.stdout.trim()}`,
    );

    gitActions.committed = true;
    gitActions.commitMessage = commitMessage;
  }

  // 5. Check if branch needs to be pushed
  const trackingResult = await sandbox.exec(
    "git rev-list @{upstream}..HEAD 2>/dev/null || echo 'needs-push'",
    cwd,
    10000,
  );

  const needsPush =
    trackingResult.stdout.includes("needs-push") ||
    trackingResult.stdout.trim().length > 0;

  if (needsPush) {
    // 5a. Fetch latest from origin to check for conflicts
    await sandbox.exec("git fetch origin", cwd, 30000);

    // 5b. Check if branch exists on remote
    const remoteBranchCheck = await sandbox.exec(
      `git ls-remote --heads origin ${resolvedBranch}`,
      cwd,
      10000,
    );
    const branchExistsOnRemote = remoteBranchCheck.stdout.trim().length > 0;

    // 5c. Push branch
    const pushResult = await sandbox.exec(
      `git push -u origin ${resolvedBranch}`,
      cwd,
      60000,
    );

    if (!pushResult.success) {
      const pushOutput = pushResult.stdout.trim() + pushResult.stderr;
      let errorMessage = "Failed to push branch.";

      if (
        pushOutput.includes("rejected") ||
        pushOutput.includes("non-fast-forward")
      ) {
        if (branchExistsOnRemote) {
          errorMessage = `Branch '${resolvedBranch}' already exists on remote with different commits. Try creating a new branch or pull the latest changes.`;
        } else {
          errorMessage = `Push rejected. The remote may have changes that conflict with your local branch.`;
        }
      } else if (
        pushOutput.includes("permission") ||
        pushOutput.includes("403")
      ) {
        errorMessage = "Permission denied. Check your GitHub access.";
      } else {
        errorMessage = `Push failed: ${pushOutput.slice(0, 200)}`;
      }

      return Response.json({ error: errorMessage }, { status: 500 });
    }

    gitActions.pushed = true;
  }

  // If commitOnly, return early without generating PR content
  if (commitOnly) {
    return Response.json({
      branchName: resolvedBranch,
      gitActions,
    });
  }

  // 6. Determine the best base ref for comparison
  // Reuse the baseRef we determined earlier, but re-check after push
  // since origin/<base> should now be available
  let finalBaseRef = baseRef;

  // After push, try again to get origin/<base> (might be available now)
  if (finalBaseRef === baseBranch || finalBaseRef === "FETCH_HEAD") {
    const remoteRefResult = await sandbox.exec(
      `git rev-parse --verify origin/${baseBranch}`,
      cwd,
      10000,
    );
    if (remoteRefResult.success && remoteRefResult.stdout.trim()) {
      finalBaseRef = `origin/${baseBranch}`;
      console.log(
        `[generate-pr] After push, found origin/${baseBranch} at ${remoteRefResult.stdout.trim().slice(0, 8)}`,
      );
    }
  }

  // Debug: log current state
  const debugHead = await sandbox.exec("git rev-parse HEAD", cwd, 5000);
  const debugBase = await sandbox.exec(
    `git rev-parse ${finalBaseRef}`,
    cwd,
    5000,
  );
  const baseResolved = debugBase.success
    ? debugBase.stdout.trim().slice(0, 8)
    : "not found";
  console.log(
    `[generate-pr] HEAD: ${debugHead.stdout.trim()}, finalBaseRef: ${finalBaseRef} -> ${baseResolved}`,
  );

  // If base ref still can't be resolved, we have a problem
  if (!debugBase.success || !debugBase.stdout.trim()) {
    return Response.json(
      {
        error: `Cannot find base branch '${baseBranch}'. Make sure the branch exists on the remote repository.`,
      },
      { status: 400 },
    );
  }

  // Get the merge-base between base and HEAD to find the common ancestor
  const mergeBaseResult = await sandbox.exec(
    `git merge-base ${finalBaseRef} HEAD`,
    cwd,
    10000,
  );
  const mergeBase = mergeBaseResult.success
    ? mergeBaseResult.stdout.trim()
    : "";
  console.log(`[generate-pr] merge-base: ${mergeBase || "none"}`);

  // 6a. Get diff stats for PR generation
  // Compare from merge-base to HEAD to show all changes
  let diffStats = "";
  if (mergeBase) {
    const diffStatsResult = await sandbox.exec(
      `git diff ${mergeBase}..HEAD --stat`,
      cwd,
      30000,
    );
    diffStats = diffStatsResult.stdout;
  }

  // Fallback: try direct comparison if merge-base approach didn't work
  if (!diffStats.trim()) {
    const directDiffResult = await sandbox.exec(
      `git diff ${finalBaseRef}..HEAD --stat`,
      cwd,
      30000,
    );
    diffStats = directDiffResult.stdout;
  }

  // 6b. Get commit log
  let commitLog = "";
  if (mergeBase) {
    const commitLogResult = await sandbox.exec(
      `git log ${mergeBase}..HEAD --oneline`,
      cwd,
      10000,
    );
    commitLog = commitLogResult.stdout;
  }

  // Fallback for commit log
  if (!commitLog.trim()) {
    const directLogResult = await sandbox.exec(
      `git log ${finalBaseRef}..HEAD --oneline`,
      cwd,
      10000,
    );
    commitLog = directLogResult.stdout;
  }

  // 7. Check if there are changes to PR
  if (!diffStats.trim() && !commitLog.trim()) {
    // Debug: check what branches/refs we're comparing
    const headRefResult = await sandbox.exec("git rev-parse HEAD", cwd, 5000);
    const baseRefParsed = await sandbox.exec(
      `git rev-parse ${finalBaseRef} 2>/dev/null || echo "unknown"`,
      cwd,
      5000,
    );
    const headCommit = headRefResult.stdout.trim().slice(0, 8) || "unknown";
    const baseCommit = baseRefParsed.stdout.trim().slice(0, 8) || "unknown";

    // If HEAD and base resolve to the same commit, there truly are no changes
    if (
      headRefResult.stdout.trim() &&
      baseRefParsed.stdout.trim() &&
      headRefResult.stdout.trim() === baseRefParsed.stdout.trim()
    ) {
      return Response.json(
        {
          error: `No changes found: branch '${resolvedBranch}' is at the same commit as '${baseBranch}'. Make some changes first.`,
        },
        { status: 400 },
      );
    }

    // Check if there are uncommitted changes that weren't committed
    const uncommittedStatus = await sandbox.exec(
      "git status --porcelain",
      cwd,
      5000,
    );
    if (uncommittedStatus.stdout.trim()) {
      return Response.json(
        {
          error: `There are uncommitted changes but they couldn't be committed. Please check if there are git issues in the sandbox.`,
        },
        { status: 400 },
      );
    }

    // Otherwise something unexpected happened
    return Response.json(
      {
        error: `No changes detected between '${resolvedBranch}' and '${baseBranch}'. HEAD: ${headCommit}, base (${finalBaseRef}): ${baseCommit}, merge-base: ${mergeBase?.slice(0, 8) || "none"}`,
      },
      { status: 400 },
    );
  }

  // 8. Generate PR title and body with AI using structured output
  let prContent: z.infer<typeof prContentSchema>;
  try {
    const { output } = await generateText({
      model: gateway("anthropic/claude-haiku-4.5"),
      output: Output.object({
        schema: prContentSchema,
      }),
      prompt: `Generate a pull request title and body for these changes.

Session: ${sessionTitle}
Branch: ${resolvedBranch} -> ${baseBranch}

Changes summary:
${diffStats}

Commits:
${commitLog}`,
    });

    // Handle case where output is undefined (model failed to generate valid object)
    if (!output) {
      prContent = {
        title: sessionTitle,
        body: `## Changes\n\n${diffStats}\n\n## Commits\n\n${commitLog}`,
      };
    } else {
      prContent = output;
    }
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      // Fallback if structured output generation fails
      prContent = {
        title: sessionTitle,
        body: `## Changes\n\n${diffStats}\n\n## Commits\n\n${commitLog}`,
      };
    } else {
      throw error;
    }
  }

  // 10. Return response
  return Response.json({
    title: prContent.title,
    body: prContent.body,
    branchName: resolvedBranch,
    ...(Object.keys(gitActions).length > 0 && { gitActions }),
  });
}
