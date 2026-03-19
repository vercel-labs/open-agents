import { connectSandbox } from "@open-harness/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSessionWithSandboxGuard,
} from "@/app/api/sessions/_lib/session-context";
import { isSandboxActive } from "@/lib/sandbox/utils";

interface GitStatusRequest {
  sessionId: string;
}

function parsePorcelainStatus(output: string): {
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  uncommittedFiles: number;
} {
  const stagedFiles = new Set<string>();
  const unstagedFiles = new Set<string>();
  const untrackedFiles = new Set<string>();

  for (const line of output.trim().split("\n")) {
    if (!line || line.length < 3) continue;

    const indexStatus = line[0];
    const worktreeStatus = line[1];
    const filePath = line.slice(3).trim();
    if (!filePath) continue;

    if (indexStatus === "?" && worktreeStatus === "?") {
      untrackedFiles.add(filePath);
      continue;
    }

    if (indexStatus !== " " && indexStatus !== "?") {
      stagedFiles.add(filePath);
    }

    if (worktreeStatus !== " " && worktreeStatus !== "?") {
      unstagedFiles.add(filePath);
    }
  }

  const uncommitted = new Set<string>([
    ...stagedFiles,
    ...unstagedFiles,
    ...untrackedFiles,
  ]);

  return {
    stagedCount: stagedFiles.size,
    unstagedCount: unstagedFiles.size,
    untrackedCount: untrackedFiles.size,
    uncommittedFiles: uncommitted.size,
  };
}

function parseRemoteRef(output: string): string | null {
  const trimmed = output.trim();
  const match = trimmed.match(/^refs\/remotes\/(.+)$/);
  if (!match || !match[1]) {
    return null;
  }
  return match[1];
}

export async function POST(req: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let body: GitStatusRequest;
  try {
    body = (await req.json()) as GitStatusRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId } = body;

  if (!sessionId) {
    return Response.json({ error: "sessionId is required" }, { status: 400 });
  }

  const sessionContext = await requireOwnedSessionWithSandboxGuard({
    userId: authResult.userId,
    sessionId,
    sandboxGuard: isSandboxActive,
    sandboxErrorMessage: "Sandbox not initialized",
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;
  const sandboxState = sessionRecord.sandboxState;
  if (!sandboxState) {
    return Response.json({ error: "Sandbox not initialized" }, { status: 400 });
  }

  try {
    const sandbox = await connectSandbox(sandboxState);
    const cwd = sandbox.workingDirectory;

    // Get current branch - detect detached HEAD explicitly
    const symbolicRefResult = await sandbox.exec(
      "git symbolic-ref --short HEAD",
      cwd,
      10000,
    );

    let branch: string;
    let isDetachedHead = false;

    if (symbolicRefResult.success && symbolicRefResult.stdout.trim()) {
      branch = symbolicRefResult.stdout.trim();
    } else {
      // Detached HEAD - get short commit hash for display
      const revParseResult = await sandbox.exec(
        "git rev-parse --short HEAD",
        cwd,
        10000,
      );
      branch = revParseResult.stdout.trim();
      isDetachedHead = true;
    }

    // Check for uncommitted changes
    const statusResult = await sandbox.exec(
      "git status --porcelain",
      cwd,
      10000,
    );
    const { stagedCount, unstagedCount, untrackedCount, uncommittedFiles } =
      parsePorcelainStatus(statusResult.stdout);
    const hasUncommittedChanges = uncommittedFiles > 0;

    // Check for commits ahead of upstream or default remote branch
    let hasUnpushedCommits = false;
    const upstreamRefResult = await sandbox.exec(
      "git rev-parse --abbrev-ref --symbolic-full-name @{upstream}",
      cwd,
      10000,
    );

    let aheadBaseRef: string | null = null;
    if (upstreamRefResult.success && upstreamRefResult.stdout.trim()) {
      aheadBaseRef = upstreamRefResult.stdout.trim();
    } else {
      const defaultRemoteRefResult = await sandbox.exec(
        "git symbolic-ref refs/remotes/origin/HEAD",
        cwd,
        10000,
      );
      aheadBaseRef = parseRemoteRef(defaultRemoteRefResult.stdout);
    }

    if (aheadBaseRef) {
      const aheadResult = await sandbox.exec(
        `git rev-list ${aheadBaseRef}..HEAD`,
        cwd,
        10000,
      );
      if (aheadResult.success) {
        hasUnpushedCommits = aheadResult.stdout.trim().length > 0;
      }
    }

    return Response.json({
      branch,
      isDetachedHead,
      hasUncommittedChanges,
      hasUnpushedCommits,
      stagedCount,
      unstagedCount,
      untrackedCount,
      uncommittedFiles: hasUncommittedChanges ? uncommittedFiles : 0,
    });
  } catch (error) {
    console.error("Failed to get git status:", error);
    return Response.json(
      { error: "Failed to connect to sandbox" },
      { status: 500 },
    );
  }
}
