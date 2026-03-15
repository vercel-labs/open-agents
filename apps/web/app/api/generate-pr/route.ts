import { connectSandbox } from "@open-harness/sandbox";
import { gateway, generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";
import {
  ensureForkExists,
  extractGitHubOwnerFromRemoteUrl,
  forkPushRetryConfig,
  generateBranchName,
  getConversationContext,
  isPermissionPushError,
  isRetryableForkPushError,
  looksLikeCommitHash,
  redactGitHubToken,
  sleepForForkRetry,
} from "@/app/api/generate-pr/_lib/generate-pr-helpers";
import { getGitHubAccount } from "@/lib/db/accounts";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { getRepoToken } from "@/lib/github/get-repo-token";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

const prContentSchema = z.object({
  title: z
    .string()
    .describe(
      "A concise PR title, max 72 characters. Should follow conventional commits format.",
    ),
  body: z
    .string()
    .describe(
      "A markdown PR body with a ## Summary section (1-2 sentences) followed by a ## Changes section grouping changes by area with file paths, e.g. **API (`path/to/file.ts`)** with bullet points. Use real newlines for line breaks, NEVER literal backslash-n sequences.",
    ),
});

// Allow up to 2 minutes for AI generation and git operations
export const maxDuration = 120;

interface GeneratePRRequest {
  sessionId: string;
  sessionTitle: string;
  baseBranch: string;
  branchName: string;
  createBranchOnly?: boolean;
  commitOnly?: boolean;
  commitTitle?: string;
  commitBody?: string;
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
    commitTitle,
    commitBody,
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
  let repoTokenResult: Awaited<ReturnType<typeof getRepoToken>> | null = null;
  let cachedUserToken: string | null = null;

  if (sessionRecord.repoOwner && sessionRecord.repoName) {
    try {
      repoTokenResult = await getRepoToken(
        session.user.id,
        sessionRecord.repoOwner,
      );
      const authUrl = `https://x-access-token:${repoTokenResult.token}@github.com/${sessionRecord.repoOwner}/${sessionRecord.repoName}.git`;
      await sandbox.exec(`git remote set-url origin "${authUrl}"`, cwd, 5000);
    } catch {
      return Response.json(
        { error: "No GitHub token available for this repository" },
        { status: 403 },
      );
    }
  }

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
    commitSha?: string;
    pushed?: boolean;
    pushedToFork?: boolean;
  } = {};
  let prHeadOwner: string | null = null;

  if (hasUncommittedChanges) {
    // 4a. Stage all changes first so untracked files are included in diff
    const addResult = await sandbox.exec("git add -A", cwd, 10000);
    if (!addResult.success) {
      return Response.json(
        { error: "Failed to stage changes" },
        { status: 500 },
      );
    }

    // 4b. Get staged diff for commit message generation
    const stagedDiffResult = await sandbox.exec(
      "git diff --cached",
      cwd,
      30000,
    );
    const diffForCommit = stagedDiffResult.stdout;

    const fallbackCommitMessage = "chore: update repository changes";

    const normalizedManualTitle = commitTitle?.trim() ?? "";
    const normalizedManualBody = commitBody?.trim() ?? "";
    const useManualCommitMessage = normalizedManualTitle.length > 0;

    // 4c. Generate commit message with AI
    let commitMessage = fallbackCommitMessage;
    if (useManualCommitMessage) {
      commitMessage = normalizedManualTitle.slice(0, 72);
    } else if (diffForCommit.trim()) {
      const commitMsgResult = await generateText({
        model: gateway("anthropic/claude-haiku-4.5"),
        prompt: `Generate a concise git commit message for these changes. Use conventional commit format (e.g., "feat:", "fix:", "refactor:"). One line only, max 72 characters.

Session context: ${sessionTitle}

Diff:
${diffForCommit.slice(0, 8000)}

Respond with ONLY the commit message, nothing else.`,
      });

      const generatedCommitMessage = commitMsgResult.text
        .trim()
        .split("\n")[0]
        ?.trim();
      if (generatedCommitMessage && generatedCommitMessage.length > 0) {
        commitMessage = generatedCommitMessage.slice(0, 72);
      }
    }

    // 4d. Create commit (escape shell special characters in message)
    // Using single quotes is safest, but we need to handle single quotes in the message
    // by ending the quote, adding an escaped single quote, and starting a new quote
    //
    // Set the git author identity to the authenticated user so the commit is
    // attributed to them. When the GitHub App rewrites the committer on push it
    // will still show the user as the author. Do NOT add a Co-Authored-By trailer
    // for the bot — the bot is already attributed as PR creator/committer, and
    // adding the trailer causes it to appear twice (as committer + co-author) on
    // squash-merged PRs, resulting in 3 authors instead of 2.
    const githubAccount = await getGitHubAccount(session.user.id);
    if (githubAccount?.externalUserId && githubAccount.username) {
      const userEmail = `${githubAccount.externalUserId}+${githubAccount.username}@users.noreply.github.com`;
      await sandbox.exec(
        `git config user.name '${githubAccount.username.replace(/'/g, "'\\''")}'`,
        cwd,
        5000,
      );
      await sandbox.exec(`git config user.email '${userEmail}'`, cwd, 5000);
    }

    const escapedMessage = commitMessage.replace(/'/g, "'\\''");
    const commitCommand =
      useManualCommitMessage && normalizedManualBody.length > 0
        ? `git commit -m '${escapedMessage}' -m '${normalizedManualBody.replace(/'/g, "'\\''")}'`
        : `git commit -m '${escapedMessage}'`;
    const commitResult = await sandbox.exec(commitCommand, cwd, 10000);

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
    const commitSha = postCommitHead.stdout.trim();
    if (commitSha.length > 0) {
      gitActions.commitSha = commitSha;
    }
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

  const upstreamRefResult = await sandbox.exec(
    "git rev-parse --abbrev-ref --symbolic-full-name @{upstream} 2>/dev/null || true",
    cwd,
    10000,
  );
  const upstreamRef = upstreamRefResult.stdout.trim();
  if (upstreamRef.startsWith("fork/")) {
    const forkUrlResult = await sandbox.exec(
      "git remote get-url fork 2>/dev/null || true",
      cwd,
      10000,
    );
    const forkOwner = extractGitHubOwnerFromRemoteUrl(forkUrlResult.stdout);
    if (forkOwner) {
      prHeadOwner = forkOwner;
    }
  }

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
    let pushResult = await sandbox.exec(
      `GIT_TERMINAL_PROMPT=0 git push --verbose -u origin ${resolvedBranch}`,
      cwd,
      60000,
    );

    if (!pushResult.success) {
      let pushOutput =
        `${pushResult.stdout}\n${pushResult.stderr ?? ""}`.trim();
      let redactedPushOutput = redactGitHubToken(pushOutput);
      console.log(
        `[generate-pr] Push to origin failed (exitCode=${pushResult.exitCode}, output=${redactedPushOutput.slice(0, 200) || "none"})`,
      );
      let errorMessage = "Failed to push branch.";
      let isPermissionError = isPermissionPushError(pushOutput);

      // Cloud sandboxes backed by Vercel can return empty output on push failure even when
      // the actual error is a permission denial (exitCode 128 with no stderr).
      // Treat empty-output failures as potential permission errors so fallback
      // paths (user token, fork) are still attempted.
      if (!isPermissionError && !pushOutput && pushResult.exitCode === 128) {
        isPermissionError = true;
      }

      if (
        repoTokenResult?.type === "installation" &&
        sessionRecord.repoOwner &&
        sessionRecord.repoName
      ) {
        if (!cachedUserToken) {
          cachedUserToken = await getUserGitHubToken();
        }

        if (cachedUserToken) {
          const userAuthUrl = `https://x-access-token:${cachedUserToken}@github.com/${sessionRecord.repoOwner}/${sessionRecord.repoName}.git`;
          const setOriginUserAuthResult = await sandbox.exec(
            `git remote set-url origin "${userAuthUrl}"`,
            cwd,
            10000,
          );

          if (setOriginUserAuthResult.success) {
            pushResult = await sandbox.exec(
              `GIT_TERMINAL_PROMPT=0 git push --verbose -u origin ${resolvedBranch}`,
              cwd,
              60000,
            );

            if (pushResult.success) {
              console.log(
                `[generate-pr] Push to origin succeeded with user token after installation token failure`,
              );
              gitActions.pushed = true;
            } else {
              pushOutput =
                `${pushResult.stdout}\n${pushResult.stderr ?? ""}`.trim();
              redactedPushOutput = redactGitHubToken(pushOutput);
              isPermissionError = isPermissionPushError(pushOutput);
              if (
                !isPermissionError &&
                !pushOutput &&
                pushResult.exitCode === 128
              ) {
                isPermissionError = true;
              }
              console.log(
                `[generate-pr] Push to origin with user token also failed (exitCode=${pushResult.exitCode}, output=${redactedPushOutput.slice(0, 200) || "none"})`,
              );
            }
          }
        }
      }

      if (
        !gitActions.pushed &&
        isPermissionError &&
        sessionRecord.repoOwner &&
        sessionRecord.repoName
      ) {
        if (!cachedUserToken) {
          cachedUserToken = await getUserGitHubToken();
        }
        const githubAccount = await getGitHubAccount(session.user.id);

        if (cachedUserToken && githubAccount?.username) {
          const forkOwner = githubAccount.username;
          const forkResult = await ensureForkExists({
            token: cachedUserToken,
            upstreamOwner: sessionRecord.repoOwner,
            upstreamRepo: sessionRecord.repoName,
            forkOwner,
          });

          if (!forkResult.success) {
            return Response.json(
              {
                error: `Failed to push to upstream and fork fallback failed: ${forkResult.error}`,
              },
              { status: 500 },
            );
          }

          const { forkRepoName } = forkResult;
          const forkAuthUrl = `https://x-access-token:${cachedUserToken}@github.com/${forkOwner}/${forkRepoName}.git`;

          await sandbox.exec(
            "git remote remove fork 2>/dev/null || true",
            cwd,
            10000,
          );
          const addForkResult = await sandbox.exec(
            `git remote add fork "${forkAuthUrl}"`,
            cwd,
            10000,
          );

          if (!addForkResult.success) {
            return Response.json(
              {
                error: `Failed to configure fork remote: ${(addForkResult.stderr ?? addForkResult.stdout).slice(0, 200)}`,
              },
              { status: 500 },
            );
          }

          let pushToForkSucceeded = false;
          let lastPushForkOutput = "";

          for (
            let attempt = 1;
            attempt <= forkPushRetryConfig.attempts;
            attempt += 1
          ) {
            const pushForkResult = await sandbox.exec(
              `GIT_TERMINAL_PROMPT=0 git push --verbose -u fork ${resolvedBranch}`,
              cwd,
              60000,
            );

            if (pushForkResult.success) {
              pushToForkSucceeded = true;
              console.log(
                `[generate-pr] Push to origin denied; pushed branch to fork ${forkOwner}/${forkRepoName}`,
              );
              prHeadOwner = forkOwner;
              gitActions.pushed = true;
              gitActions.pushedToFork = true;
              break;
            }

            lastPushForkOutput =
              `${pushForkResult.stdout}\n${pushForkResult.stderr ?? ""}`.trim();

            if (
              isRetryableForkPushError(lastPushForkOutput) &&
              attempt < forkPushRetryConfig.attempts
            ) {
              console.log(
                `[generate-pr] Fork push retry ${attempt}/${forkPushRetryConfig.attempts}: waiting for fork repository to become available`,
              );
              await sleepForForkRetry();
              continue;
            }

            break;
          }

          if (!pushToForkSucceeded) {
            if (isPermissionPushError(lastPushForkOutput)) {
              return Response.json(
                {
                  error:
                    "Failed to push to your fork. Ensure your linked GitHub account has permission to create and push to forks.",
                },
                { status: 403 },
              );
            }

            return Response.json(
              {
                error: `Failed to push to fork ${forkOwner}/${forkRepoName}: ${redactGitHubToken(lastPushForkOutput).slice(0, 200)}`,
              },
              { status: 500 },
            );
          }
        } else {
          return Response.json(
            {
              error:
                "Failed to push to upstream and no linked GitHub account is available for fork fallback.",
            },
            { status: 500 },
          );
        }
      }

      if (!gitActions.pushed) {
        if (
          pushOutput.includes("rejected") ||
          pushOutput.includes("non-fast-forward")
        ) {
          if (branchExistsOnRemote) {
            errorMessage = `Branch '${resolvedBranch}' already exists on remote with different commits. Try creating a new branch or pull the latest changes.`;
          } else {
            errorMessage = `Push rejected. The remote may have changes that conflict with your local branch.`;
          }
        } else if (isPermissionError) {
          errorMessage = "Permission denied. Check your GitHub access.";
        } else {
          errorMessage = `Push failed: ${redactedPushOutput.slice(0, 200)}`;
        }

        return Response.json({ error: errorMessage }, { status: 500 });
      }
    }

    gitActions.pushed = true;
  }

  // If commitOnly, return early without generating PR content
  if (commitOnly) {
    return Response.json({
      branchName: resolvedBranch,
      gitActions,
      ...(prHeadOwner ? { prHeadOwner } : {}),
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
  // Load conversation context (user + assistant text parts only) for richer PR descriptions
  const conversationContext = await getConversationContext(sessionId);
  const conversationSection = conversationContext
    ? `\nConversation context:\n${conversationContext.slice(0, 8000)}\n`
    : "";

  let prContent: z.infer<typeof prContentSchema>;
  try {
    const { output } = await generateText({
      model: gateway("anthropic/claude-haiku-4.5"),
      output: Output.object({
        schema: prContentSchema,
      }),
      prompt: `Generate a pull request title and body for these changes.

CRITICAL FORMATTING RULE: The body field must contain real newlines (actual line breaks), NOT literal backslash-n sequences. Never write \\n in the output — use actual new lines instead.

The body MUST follow this exact format:

## Summary

<One or two sentences describing the overall purpose of the PR.>

## Changes

**<Group label> (\`<file path>\`)**

- <Change description>
- <Change description>

**<Group label> (\`<file path>\`)**

- <Change description>
- <Change description>

Group related changes by area (e.g. API, UI, Config, Tests) and include the file path in backticks after the group label. Each change should be a concise bullet point. If a group has sub-details, use nested bullets.

Session: ${sessionTitle}
Branch: ${resolvedBranch} -> ${baseBranch}
${conversationSection}
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
    ...(prHeadOwner ? { prHeadOwner } : {}),
    ...(Object.keys(gitActions).length > 0 && { gitActions }),
  });
}
