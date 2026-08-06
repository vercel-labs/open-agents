import { getChatMessages, getChatsBySessionId } from "@/lib/db/sessions";

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
export function looksLikeCommitHash(str: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(str);
}

export function isPermissionPushError(output: string): boolean {
  const lowerOutput = output.toLowerCase();
  return (
    lowerOutput.includes("permission to") ||
    lowerOutput.includes("permission denied") ||
    lowerOutput.includes("the requested url returned error: 403") ||
    lowerOutput.includes("access denied") ||
    lowerOutput.includes("authentication failed") ||
    lowerOutput.includes("invalid username") ||
    lowerOutput.includes("unable to access") ||
    lowerOutput.includes("resource not accessible by integration")
  );
}

export function redactGitHubToken(text: string): string {
  return text.replace(
    /https:\/\/x-access-token:[^@\s]+@github\.com/gi,
    "https://x-access-token:***@github.com",
  );
}

export function extractGitHubOwnerFromRemoteUrl(
  remoteUrl: string,
): string | null {
  const trimmedRemoteUrl = remoteUrl.trim();
  if (!trimmedRemoteUrl) {
    return null;
  }

  const githubUrlMatch = trimmedRemoteUrl.match(
    /github\.com[:/]([^/]+)\/[^/]+$/i,
  );
  if (githubUrlMatch?.[1]) {
    return githubUrlMatch[1];
  }

  return null;
}

/**
 * Extracts user and assistant text parts from all chat messages in a session.
 * Tool calls and tool results are intentionally excluded to keep context
 * focused on the human–AI conversation.
 */
export async function getConversationContext(
  sessionId: string,
): Promise<string> {
  const chats = await getChatsBySessionId(sessionId);
  if (chats.length === 0) return "";

  const lines: string[] = [];

  for (const chat of chats) {
    const messages = await getChatMessages(chat.id);
    for (const message of messages) {
      if (!Array.isArray(message.parts)) continue;

      const textParts: string[] = [];
      for (const part of message.parts) {
        if (
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          part.type === "text" &&
          "text" in part &&
          typeof part.text === "string" &&
          part.text.trim().length > 0
        ) {
          textParts.push(part.text.trim());
        }
      }

      if (textParts.length > 0) {
        const role = message.role === "user" ? "User" : "Assistant";
        lines.push(`${role}: ${textParts.join(" ")}`);
      }
    }
  }

  return lines.join("\n");
}
