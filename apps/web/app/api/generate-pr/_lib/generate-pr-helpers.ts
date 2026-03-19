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

interface EnsureForkOptions {
  token: string;
  upstreamOwner: string;
  upstreamRepo: string;
  forkOwner: string;
}

type EnsureForkResult =
  | { success: true; forkRepoName: string }
  | { success: false; error: string };

const FORK_PUSH_RETRY_ATTEMPTS = 12;
const FORK_PUSH_RETRY_DELAY_MS = 2000;

function getGitHubHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

export function isRetryableForkPushError(output: string): boolean {
  const lowerOutput = output.toLowerCase();
  return (
    lowerOutput.includes("repository not found") ||
    lowerOutput.includes("could not read from remote repository") ||
    lowerOutput.includes("remote not found")
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

export async function ensureForkExists({
  token,
  upstreamOwner,
  upstreamRepo,
  forkOwner,
}: EnsureForkOptions): Promise<EnsureForkResult> {
  const headers = getGitHubHeaders(token);
  const forkRepoUrl = `https://api.github.com/repos/${forkOwner}/${upstreamRepo}`;

  const publicForkResponse = await fetch(forkRepoUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });

  if (publicForkResponse.ok) {
    const repoData: unknown = await publicForkResponse.json();
    const forkRepoName =
      typeof repoData === "object" &&
      repoData !== null &&
      "name" in repoData &&
      typeof repoData.name === "string"
        ? repoData.name
        : upstreamRepo;
    return { success: true, forkRepoName };
  }

  const existingForkResponse = await fetch(forkRepoUrl, {
    headers,
    cache: "no-store",
  });

  if (existingForkResponse.ok) {
    const repoData: unknown = await existingForkResponse.json();
    const forkRepoName =
      typeof repoData === "object" &&
      repoData !== null &&
      "name" in repoData &&
      typeof repoData.name === "string"
        ? repoData.name
        : upstreamRepo;
    return { success: true, forkRepoName };
  }

  if (existingForkResponse.status !== 404) {
    const responseText = await existingForkResponse.text();
    return {
      success: false,
      error: `Failed to check fork repository: ${responseText.slice(0, 200)}`,
    };
  }

  const createForkResponse = await fetch(
    `https://api.github.com/repos/${upstreamOwner}/${upstreamRepo}/forks`,
    {
      method: "POST",
      headers,
      cache: "no-store",
    },
  );

  if (
    !createForkResponse.ok &&
    createForkResponse.status !== 202 &&
    createForkResponse.status !== 422
  ) {
    const responseText = await createForkResponse.text();
    const lowerResponseText = responseText.toLowerCase();

    if (
      createForkResponse.status === 403 &&
      lowerResponseText.includes("resource not accessible by integration")
    ) {
      return {
        success: false,
        error:
          "GitHub denied automatic fork creation for this token. Create a fork manually on GitHub, then retry creating the PR.",
      };
    }

    return {
      success: false,
      error: `Failed to create fork: ${responseText.slice(0, 200)}`,
    };
  }

  const createData: unknown = await createForkResponse.json().catch(() => null);
  const forkRepoName =
    typeof createData === "object" &&
    createData !== null &&
    "name" in createData &&
    typeof createData.name === "string"
      ? createData.name
      : upstreamRepo;
  return { success: true, forkRepoName };
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

export const forkPushRetryConfig = {
  attempts: FORK_PUSH_RETRY_ATTEMPTS,
  delayMs: FORK_PUSH_RETRY_DELAY_MS,
} as const;

export async function sleepForForkRetry(): Promise<void> {
  await sleep(FORK_PUSH_RETRY_DELAY_MS);
}
