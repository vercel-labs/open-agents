"use server";

import { connectSandbox } from "@open-agents/sandbox";
import { getSessionById } from "@/lib/db/sessions";
import { isSafeBranchName } from "@/lib/git/helpers";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

// ---- types ----

export interface SessionGitStatus {
  branch: string;
  isDetachedHead: boolean;
  hasUncommittedChanges: boolean;
  hasUnpushedCommits: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  uncommittedFiles: number;
}

// ---- helpers ----

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
  if (!match?.[1]) {
    return null;
  }
  return match[1];
}

async function requireAuth() {
  const session = await getServerSession();
  if (!session?.user) {
    throw new Error("Not authenticated");
  }
  return session;
}

async function requireOwnedSession(userId: string, sessionId: string) {
  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    throw new Error("Session not found");
  }
  if (sessionRecord.userId !== userId) {
    throw new Error("Forbidden");
  }
  return sessionRecord;
}

// ---- server action ----

export async function getGitStatus(params: {
  sessionId: string;
}): Promise<SessionGitStatus | null> {
  const { sessionId } = params;

  const session = await requireAuth();
  const sessionRecord = await requireOwnedSession(session.user.id, sessionId);

  if (!isSandboxActive(sessionRecord.sandboxState)) {
    throw new Error("Sandbox not initialized");
  }

  const sandboxState = sessionRecord.sandboxState;
  if (!sandboxState) {
    throw new Error("Sandbox not initialized");
  }

  try {
    const sandbox = await connectSandbox(sandboxState);
    const cwd = sandbox.workingDirectory;

    // get current branch - detect detached HEAD explicitly
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
      // detached HEAD - get short commit hash for display
      const revParseResult = await sandbox.exec(
        "git rev-parse --short HEAD",
        cwd,
        10000,
      );
      branch = revParseResult.stdout.trim();
      isDetachedHead = true;
    }

    // check for uncommitted changes
    const statusResult = await sandbox.exec(
      "git status --porcelain",
      cwd,
      10000,
    );
    const { stagedCount, unstagedCount, untrackedCount, uncommittedFiles } =
      parsePorcelainStatus(statusResult.stdout);
    const hasUncommittedChanges = uncommittedFiles > 0;

    // check for commits ahead of upstream or default remote branch
    let hasUnpushedCommits = false;
    const upstreamRefResult = await sandbox.exec(
      "git rev-parse --abbrev-ref --symbolic-full-name @{upstream}",
      cwd,
      10000,
    );

    let aheadBaseRef: string | null = null;
    if (upstreamRefResult.success && upstreamRefResult.stdout.trim()) {
      aheadBaseRef = upstreamRefResult.stdout.trim();
    } else if (!isDetachedHead && isSafeBranchName(branch)) {
      const remoteBranchResult = await sandbox.exec(
        `git rev-parse --verify origin/${branch}`,
        cwd,
        10000,
      );
      if (remoteBranchResult.success && remoteBranchResult.stdout.trim()) {
        aheadBaseRef = `origin/${branch}`;
      }
    }

    if (!aheadBaseRef) {
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

    return {
      branch,
      isDetachedHead,
      hasUncommittedChanges,
      hasUnpushedCommits,
      stagedCount,
      unstagedCount,
      untrackedCount,
      uncommittedFiles: hasUncommittedChanges ? uncommittedFiles : 0,
    };
  } catch (error) {
    console.error("Failed to get git status:", error);
    return null;
  }
}
