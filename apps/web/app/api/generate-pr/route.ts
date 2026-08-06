import { connectSandbox } from "@open-agents/sandbox";
import { checkBotProtection } from "@/lib/botid";
import { generateBranchName, looksLikeCommitHash } from "@/lib/git/helpers";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { generatePullRequestContentFromSandbox } from "@/lib/github/pr-content";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

// allow up to 2 minutes for AI generation and git operations
export const maxDuration = 120;

interface GeneratePRRequest {
  sessionId: string;
  sessionTitle: string;
  baseBranch: string;
  branchName: string;
  createBranchOnly?: boolean;
}

export async function POST(req: Request) {
  // 1. validate session
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const botVerification = await checkBotProtection();
  if (botVerification.isBot) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  const limited = await checkRateLimit({
    key: rateLimitKey(["generate-pr", session.user.id]),
    limit: 5,
    windowMs: 60_000,
  });
  if (limited) {
    return limited;
  }

  // 2. parse request
  let body: GeneratePRRequest;
  try {
    body = (await req.json()) as GeneratePRRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId, sessionTitle, baseBranch, branchName, createBranchOnly } =
    body;

  if (!sessionId) {
    return Response.json({ error: "Session ID is required" }, { status: 400 });
  }

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

  const safeBranchPattern = /^[\w\-/.]+$/;
  if (!safeBranchPattern.test(baseBranch)) {
    return Response.json(
      { error: "Invalid base branch name" },
      { status: 400 },
    );
  }

  // 3. connect to sandbox
  const sandbox = await connectSandbox(sessionRecord.sandboxState);
  const cwd = sandbox.workingDirectory;

  // 3a. resolve live branch from sandbox
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

  // 3b. fetch latest from origin
  const fetchResult = await sandbox.exec(
    `git fetch origin ${baseBranch}:refs/remotes/origin/${baseBranch}`,
    cwd,
    30000,
  );
  console.log(
    `[generate-pr] Fetch result: success=${fetchResult.success}, stdout=${fetchResult.stdout.trim()}, stderr=${fetchResult.stderr?.trim() ?? ""}`,
  );

  // 3c. check for uncommitted changes
  const statusResult = await sandbox.exec("git status --porcelain", cwd, 10000);
  const hasUncommitted = statusResult.stdout.trim().length > 0;

  console.log(
    `[generate-pr] Initial state - branch: ${resolvedBranch}, baseBranch: ${baseBranch}, uncommitted: ${hasUncommitted}`,
  );

  // 3d. determine base ref
  let baseRef = baseBranch;

  const originRefCheck = await sandbox.exec(
    `git rev-parse --verify origin/${baseBranch}`,
    cwd,
    10000,
  );
  if (originRefCheck.success && originRefCheck.stdout.trim()) {
    baseRef = `origin/${baseBranch}`;
  } else {
    const localRefCheck = await sandbox.exec(
      `git rev-parse --verify ${baseBranch}`,
      cwd,
      10000,
    );
    if (localRefCheck.success && localRefCheck.stdout.trim()) {
      baseRef = baseBranch;
    } else {
      const fetchHeadCheck = await sandbox.exec(
        "git rev-parse FETCH_HEAD",
        cwd,
        10000,
      );
      if (fetchHeadCheck.success && fetchHeadCheck.stdout.trim()) {
        baseRef = "FETCH_HEAD";
      }
    }
  }

  const commitsAheadResult = await sandbox.exec(
    `git rev-list ${baseRef}..HEAD`,
    cwd,
    10000,
  );
  const hasCommitsAhead = commitsAheadResult.stdout.trim().length > 0;

  // create branch if on base branch or detached head
  const isDetachedOrOnBase =
    resolvedBranch === baseBranch || looksLikeCommitHash(resolvedBranch);

  const shouldCreateBranch =
    isDetachedOrOnBase &&
    (createBranchOnly || hasUncommitted || hasCommitsAhead);

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
        { error: `Failed to create branch: ${checkoutResult.stdout}` },
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

  // 4. generate PR content (commits should be done via the commitChanges server action)
  if (hasUncommitted) {
    return Response.json(
      {
        error:
          "Uncommitted changes — commit first before generating PR content",
      },
      { status: 400 },
    );
  }

  const prContentResult = await generatePullRequestContentFromSandbox({
    sandbox,
    sessionId,
    sessionTitle,
    baseBranch,
    branchName: resolvedBranch,
    baseRef,
    appBaseUrl: new URL(req.url).origin,
  });

  if (!prContentResult.success) {
    return Response.json({ error: prContentResult.error }, { status: 400 });
  }

  return Response.json({
    title: prContentResult.title,
    body: prContentResult.body,
    branchName: resolvedBranch,
  });
}
