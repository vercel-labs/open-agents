import type { Sandbox } from "@open-harness/sandbox";
import { gateway } from "@open-harness/agent";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";
import { getConversationContext } from "@/app/api/generate-pr/_lib/generate-pr-helpers";

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

const SAFE_BRANCH_PATTERN = /^[\w\-/.]+$/;

export interface GeneratePullRequestContentParams {
  sandbox: Sandbox;
  sessionId: string;
  sessionTitle: string;
  baseBranch: string;
  branchName: string;
  baseRef?: string;
}

export type GeneratePullRequestContentResult =
  | {
      success: true;
      title: string;
      body: string;
      diffStats: string;
      commitLog: string;
      baseRef: string;
      mergeBase: string | null;
    }
  | {
      success: false;
      error: string;
    };

export async function generatePullRequestContentFromSandbox(
  params: GeneratePullRequestContentParams,
): Promise<GeneratePullRequestContentResult> {
  const { sandbox, sessionId, sessionTitle, baseBranch, branchName } = params;
  const cwd = sandbox.workingDirectory;

  if (!SAFE_BRANCH_PATTERN.test(baseBranch)) {
    return { success: false, error: "Invalid base branch name" };
  }

  if (!SAFE_BRANCH_PATTERN.test(branchName)) {
    return { success: false, error: "Invalid branch name" };
  }

  let finalBaseRef = params.baseRef ?? baseBranch;

  if (!SAFE_BRANCH_PATTERN.test(finalBaseRef)) {
    return { success: false, error: "Invalid base ref" };
  }

  if (finalBaseRef === baseBranch || finalBaseRef === "FETCH_HEAD") {
    const remoteRefResult = await sandbox.exec(
      `git rev-parse --verify origin/${baseBranch}`,
      cwd,
      10000,
    );
    if (remoteRefResult.success && remoteRefResult.stdout.trim()) {
      finalBaseRef = `origin/${baseBranch}`;
    }
  }

  const debugHead = await sandbox.exec("git rev-parse HEAD", cwd, 5000);
  const debugBase = await sandbox.exec(`git rev-parse ${finalBaseRef}`, cwd, 5000);
  if (!debugBase.success || !debugBase.stdout.trim()) {
    return {
      success: false,
      error: `Cannot find base branch '${baseBranch}'. Make sure the branch exists on the remote repository.`,
    };
  }

  const mergeBaseResult = await sandbox.exec(
    `git merge-base ${finalBaseRef} HEAD`,
    cwd,
    10000,
  );
  const mergeBase = mergeBaseResult.success
    ? mergeBaseResult.stdout.trim() || null
    : null;

  let diffStats = "";
  if (mergeBase) {
    const diffStatsResult = await sandbox.exec(
      `git diff ${mergeBase}..HEAD --stat`,
      cwd,
      30000,
    );
    diffStats = diffStatsResult.stdout;
  }

  if (!diffStats.trim()) {
    const directDiffResult = await sandbox.exec(
      `git diff ${finalBaseRef}..HEAD --stat`,
      cwd,
      30000,
    );
    diffStats = directDiffResult.stdout;
  }

  let commitLog = "";
  if (mergeBase) {
    const commitLogResult = await sandbox.exec(
      `git log ${mergeBase}..HEAD --oneline`,
      cwd,
      10000,
    );
    commitLog = commitLogResult.stdout;
  }

  if (!commitLog.trim()) {
    const directLogResult = await sandbox.exec(
      `git log ${finalBaseRef}..HEAD --oneline`,
      cwd,
      10000,
    );
    commitLog = directLogResult.stdout;
  }

  if (!diffStats.trim() && !commitLog.trim()) {
    const headCommit = debugHead.stdout.trim().slice(0, 8) || "unknown";
    const baseCommit = debugBase.stdout.trim().slice(0, 8) || "unknown";

    if (
      debugHead.stdout.trim() &&
      debugBase.stdout.trim() &&
      debugHead.stdout.trim() === debugBase.stdout.trim()
    ) {
      return {
        success: false,
        error: `No changes found: branch '${branchName}' is at the same commit as '${baseBranch}'. Make some changes first.`,
      };
    }

    const uncommittedStatus = await sandbox.exec("git status --porcelain", cwd, 5000);
    if (uncommittedStatus.stdout.trim()) {
      return {
        success: false,
        error:
          "There are uncommitted changes but they couldn't be committed. Please check if there are git issues in the sandbox.",
      };
    }

    return {
      success: false,
      error: `No changes detected between '${branchName}' and '${baseBranch}'. HEAD: ${headCommit}, base (${finalBaseRef}): ${baseCommit}, merge-base: ${mergeBase?.slice(0, 8) || "none"}`,
    };
  }

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
Branch: ${branchName} -> ${baseBranch}
${conversationSection}
Changes summary:
${diffStats}

Commits:
${commitLog}`,
    });

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
      prContent = {
        title: sessionTitle,
        body: `## Changes\n\n${diffStats}\n\n## Commits\n\n${commitLog}`,
      };
    } else {
      throw error;
    }
  }

  return {
    success: true,
    title: prContent.title,
    body: prContent.body,
    diffStats,
    commitLog,
    baseRef: finalBaseRef,
    mergeBase,
  };
}
