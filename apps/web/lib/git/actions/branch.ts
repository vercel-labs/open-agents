"use server";

import { connectSandbox } from "@open-agents/sandbox";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";
import {
  generateBranchName,
  isSafeBranchName,
  looksLikeCommitHash,
} from "@/lib/git/helpers";

/**
 * Create a feature branch in the session sandbox.
 */
export async function createBranch(params: {
  sessionId: string;
  sessionTitle: string;
  baseBranch: string;
  branchName: string;
}): Promise<{ branchName: string }> {
  const { sessionId, baseBranch, branchName } = params;

  const session = await getServerSession();
  if (!session?.user) {
    throw new Error("Not authenticated");
  }

  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    throw new Error("Session not found");
  }
  if (sessionRecord.userId !== session.user.id) {
    throw new Error("Forbidden");
  }
  if (!isSandboxActive(sessionRecord.sandboxState)) {
    throw new Error("Sandbox not initialized");
  }
  if (!baseBranch || !isSafeBranchName(baseBranch)) {
    throw new Error("Invalid base branch name");
  }
  if (!branchName || (branchName !== "HEAD" && !isSafeBranchName(branchName))) {
    throw new Error("Invalid branch name");
  }

  const sandbox = await connectSandbox(sessionRecord.sandboxState);
  const cwd = sandbox.workingDirectory;

  // resolve live branch
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

  // fetch from origin
  await sandbox.exec(
    `git fetch origin ${baseBranch}:refs/remotes/origin/${baseBranch}`,
    cwd,
    30000,
  );

  // create branch if on base or detached
  const isDetachedOrOnBase =
    resolvedBranch === baseBranch || looksLikeCommitHash(resolvedBranch);

  if (isDetachedOrOnBase) {
    const generatedBranch = generateBranchName(
      session.user.username,
      session.user.name,
    );
    if (!isSafeBranchName(generatedBranch)) {
      throw new Error("Invalid generated branch name");
    }
    const checkoutResult = await sandbox.exec(
      `git checkout -b ${generatedBranch}`,
      cwd,
      10000,
    );
    if (!checkoutResult.success) {
      throw new Error(`Failed to create branch: ${checkoutResult.stdout}`);
    }
    resolvedBranch = generatedBranch;
  }

  if (!isSafeBranchName(resolvedBranch)) {
    throw new Error("Invalid branch name");
  }

  if (resolvedBranch !== branchName) {
    await updateSession(sessionId, { branch: resolvedBranch }).catch(
      (error) => {
        console.error("Failed to update session branch:", error);
      },
    );
  }

  return { branchName: resolvedBranch };
}
