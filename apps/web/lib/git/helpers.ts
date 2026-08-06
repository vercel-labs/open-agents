import { generateText } from "ai";
import { gateway } from "@open-agents/agent";

export const SAFE_BRANCH_PATTERN = /^[\w\-/.]+$/;

export function isSafeBranchName(branch: string): boolean {
  return (
    SAFE_BRANCH_PATTERN.test(branch) &&
    !branch.includes("..") &&
    !branch.includes("//") &&
    !branch.startsWith("/") &&
    !branch.endsWith("/") &&
    !branch.endsWith(".lock")
  );
}

export function generateBranchName(
  username: string,
  name?: string | null,
): string {
  let initials = "nb";
  if (name) {
    initials =
      name
        .split(" ")
        .map((part) => part[0]?.toLowerCase() ?? "")
        .join("")
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 2) || "nb";
  } else if (username) {
    initials = username
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 2);
    if (!initials) {
      initials = "nb";
    }
  }
  const randomSuffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${initials}/${randomSuffix}`;
}

/**
 * Detects if a string looks like a git commit hash (detached HEAD state).
 * Git short hashes are 7+ hex chars, full hashes are 40.
 */
export function looksLikeCommitHash(str: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(str);
}

export async function generateCommitMessage(
  diff: string,
  sessionTitle: string,
): Promise<string> {
  const fallback = "chore: update repository changes";
  if (!diff.trim()) return fallback;

  try {
    const result = await generateText({
      model: gateway("anthropic/claude-haiku-4.5"),
      prompt: `Generate a concise git commit message for these changes. Use conventional commit format (e.g., "feat:", "fix:", "refactor:"). One line only, max 72 characters.

Session context: ${sessionTitle}

Diff:
${diff.slice(0, 8000)}

Respond with ONLY the commit message, nothing else.`,
    });

    const generated = result.text.trim().split("\n")[0]?.trim();
    if (generated && generated.length > 0) {
      return generated.slice(0, 72);
    }
  } catch (error) {
    console.warn("[commit] failed to generate commit message:", error);
  }

  return fallback;
}
