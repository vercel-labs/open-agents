import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import type { PullRequestCheckRun } from "@/lib/github/client";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { Octokit } from "@octokit/rest";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

type FixChecksRequest = {
  checkRuns: PullRequestCheckRun[];
};

type FixCheckSnippet = {
  filename: string;
  content: string;
};

type FixChecksResponse = {
  prompt: string;
  snippets: FixCheckSnippet[];
};

const MAX_LOG_LENGTH = 8000;
const MAX_CHECK_RUNS = 10;
const UNABLE_TO_FETCH_LOGS = "(Unable to fetch logs)";

function formatSnippetFilename(
  run: PullRequestCheckRun,
  index: number,
): string {
  const slug = run.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${String(index + 1).padStart(2, "0")}-${slug || "failing-check"}.log`;
}

function formatSnippetContent(
  run: PullRequestCheckRun,
  logText: string | undefined,
): string {
  const lines = [`Check: ${run.name}`];

  if (run.detailsUrl) {
    lines.push(`Details: ${run.detailsUrl}`);
  }

  if (!logText) {
    return lines.join("\n");
  }

  lines.push("");

  if (logText === UNABLE_TO_FETCH_LOGS) {
    lines.push(logText);
    return lines.join("\n");
  }

  const truncated =
    logText.length > MAX_LOG_LENGTH
      ? `${logText.slice(0, MAX_LOG_LENGTH)}\n\n... (truncated, ${logText.length - MAX_LOG_LENGTH} more characters)`
      : logText;

  lines.push(truncated);
  return lines.join("\n");
}

function formatFixResponse(
  checkRuns: PullRequestCheckRun[],
  logs: Record<string, string>,
): FixChecksResponse {
  const noun = checkRuns.length === 1 ? "check is" : "checks are";
  const names = checkRuns.map((run) => run.name).join(", ");

  return {
    prompt: `# Fix Failing Checks\n\nThe following ${noun} failing on this pull request: ${names}. Review the attached snippets, identify the root cause, and push a fix.`,
    snippets: checkRuns.map((run, index) => ({
      filename: formatSnippetFilename(run, index),
      content: formatSnippetContent(
        run,
        run.id > 0 ? logs[String(run.id)] : undefined,
      ),
    })),
  };
}

/**
 * Builds a "fix failing checks" prompt plus native snippet attachments.
 *
 * Requires the GitHub App to have `actions: read` permission.
 *
 * Request body:
 *   { checkRuns: PullRequestCheckRun[] } — the failing check runs
 *
 * Returns:
 *   { prompt: string, snippets: { filename: string, content: string }[] }
 */
export async function POST(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;
  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;

  if (!sessionRecord.repoOwner || !sessionRecord.repoName) {
    return Response.json(
      { error: "Session is not linked to a GitHub repository" },
      { status: 400 },
    );
  }

  let body: FixChecksRequest;
  try {
    body = (await req.json()) as FixChecksRequest;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { checkRuns } = body;
  if (!Array.isArray(checkRuns) || checkRuns.length === 0) {
    return Response.json({ error: "No check runs provided" }, { status: 400 });
  }

  if (checkRuns.length > MAX_CHECK_RUNS) {
    return Response.json(
      { error: `Too many check runs (max ${MAX_CHECK_RUNS})` },
      { status: 400 },
    );
  }

  const runsWithIds = checkRuns.filter((run) => run.id > 0);
  const logs: Record<string, string> = {};

  if (runsWithIds.length > 0) {
    const token = await getUserGitHubToken(authResult.userId);
    if (!token) {
      return Response.json(formatFixResponse(checkRuns, logs));
    }

    const octokit = new Octokit({ auth: token });
    const owner = sessionRecord.repoOwner;
    const repo = sessionRecord.repoName;

    await Promise.all(
      runsWithIds.map(async (run) => {
        try {
          const response =
            await octokit.rest.actions.downloadJobLogsForWorkflowRun({
              owner,
              repo,
              job_id: run.id,
            });
          logs[String(run.id)] =
            typeof response.data === "string"
              ? response.data
              : String(response.data);
        } catch {
          logs[String(run.id)] = UNABLE_TO_FETCH_LOGS;
        }
      }),
    );
  }

  return Response.json(formatFixResponse(checkRuns, logs));
}
