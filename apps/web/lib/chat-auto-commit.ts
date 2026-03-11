interface AutoCommitLogger {
  warn: (...data: unknown[]) => void;
  error: (...data: unknown[]) => void;
}

interface AutoCommitBackgroundParams {
  requestUrl: string;
  cookieHeader: string;
  sessionId: string;
  sessionTitle: string;
  repoOwner: string;
  repoName: string;
  fetchImpl?: typeof fetch;
  logger?: AutoCommitLogger;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function runAutoCommitInBackground({
  requestUrl,
  cookieHeader,
  sessionId,
  sessionTitle,
  repoOwner,
  repoName,
  fetchImpl = fetch,
  logger = console,
}: AutoCommitBackgroundParams): Promise<void> {
  const branchUrl = new URL("/api/github/branches", requestUrl);
  branchUrl.searchParams.set("owner", repoOwner);
  branchUrl.searchParams.set("repo", repoName);

  let baseBranch = "main";
  try {
    const branchResponse = await fetchImpl(branchUrl, {
      method: "GET",
      headers: {
        cookie: cookieHeader,
      },
      cache: "no-store",
    });

    if (branchResponse.ok) {
      const branchData: unknown = await branchResponse.json().catch(() => null);
      if (
        isRecord(branchData) &&
        typeof branchData.defaultBranch === "string" &&
        branchData.defaultBranch.trim().length > 0
      ) {
        baseBranch = branchData.defaultBranch;
      }
    } else {
      logger.warn(
        `[chat] Failed to resolve default branch for auto commit in session ${sessionId}: ${branchResponse.status}`,
      );
    }
  } catch (error) {
    logger.error(
      `[chat] Failed to resolve default branch for auto commit in session ${sessionId}:`,
      error,
    );
  }

  const autoCommitResponse = await fetchImpl(
    new URL("/api/generate-pr", requestUrl),
    {
      method: "POST",
      headers: {
        cookie: cookieHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        sessionTitle,
        baseBranch,
        branchName: "HEAD",
        commitOnly: true,
      }),
      cache: "no-store",
    },
  );

  if (!autoCommitResponse.ok) {
    const responseData: unknown = await autoCommitResponse
      .json()
      .catch(() => null);
    const errorMessage =
      isRecord(responseData) && typeof responseData.error === "string"
        ? responseData.error
        : autoCommitResponse.statusText;
    logger.error(
      `[chat] Auto commit failed for session ${sessionId}: ${errorMessage}`,
    );
    return;
  }

  const diffUrl = new URL(`/api/sessions/${sessionId}/diff`, requestUrl);
  const diffResponse = await fetchImpl(diffUrl, {
    method: "GET",
    headers: {
      cookie: cookieHeader,
    },
    cache: "no-store",
  });

  if (!diffResponse.ok) {
    logger.warn(
      `[chat] Failed to refresh cached diff after auto commit for session ${sessionId}: ${diffResponse.status}`,
    );
  }
}
