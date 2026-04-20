import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import type { PullRequestCheckRun } from "@/lib/github/client";
import { getUserGitHubToken } from "@/lib/github/token";
import { Octokit } from "@octokit/rest";
import { gateway, generateText } from "ai";

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

type CheckAnnotation = {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: string;
  message: string;
  title?: string;
};

const MAX_CHECK_RUNS = 10;
const UNABLE_TO_FETCH_LOGS = "(Unable to fetch logs)";

/**
 * Max characters of raw log to feed into the summarization LLM.
 * Haiku's context window is large enough for this, and we want to give it
 * as much as possible so it can find the real errors.
 */
const MAX_RAW_LOG_INPUT = 180_000;

const LOG_SUMMARIZATION_PROMPT = `You are a CI log analyst. Your only job is to take raw GitHub Actions job logs and extract the useful information, cutting out all the noise.

Given the full log output of a failing CI job, return a compacted version that includes:

1. **Setup context** — a few lines identifying the job name, runner, and environment (keep it very short)
2. **The actual errors** — the complete error messages, stack traces, failing test names, type errors, lint violations, etc. Preserve these EXACTLY as they appear — do not summarize or paraphrase error messages. Include enough surrounding context (a few lines before/after) to understand what step or command produced the error.
3. **Exit summary** — the final few lines showing exit codes, timing, and overall pass/fail status

Cut out ONLY if the step/operation succeeded:
- Dependency installation logs (npm install, apt-get, etc.) — but KEEP if installation failed
- Cache restore/save operations — but KEEP if caching failed
- Downloading/uploading artifacts — but KEEP if the transfer failed
- Git checkout/fetch steps — but KEEP if checkout/fetch failed
- Verbose build output — but KEEP if the build failed
- Repeated/redundant timestamp prefixes (but keep one instance so the reader knows the format)

If a step failed, include its FULL output — the failure details are exactly what the developer needs.

Return ONLY the compacted log content. Do not add commentary, explanations, or markdown formatting around it. Preserve the original log format and line structure for the parts you keep. Use "..." on its own line to indicate where you've cut content.`;

// ── Formatting helpers ──────────────────────────────────────────────────

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

function formatAnnotations(annotations: CheckAnnotation[]): string {
  if (annotations.length === 0) return "";

  const lines = ["## Annotations", ""];
  for (const ann of annotations) {
    const loc =
      ann.start_line === ann.end_line
        ? `${ann.path}:${ann.start_line}`
        : `${ann.path}:${ann.start_line}-${ann.end_line}`;
    const level = ann.annotation_level.toUpperCase();
    const title = ann.title ? ` ${ann.title}:` : "";
    lines.push(`- **${level}** \`${loc}\`${title} ${ann.message}`);
  }
  return lines.join("\n");
}

function formatSnippetContent(
  run: PullRequestCheckRun,
  compactedLog: string | undefined,
  annotations: CheckAnnotation[] | undefined,
): string {
  const lines = [`Check: ${run.name}`];

  if (run.detailsUrl) {
    lines.push(`Details: ${run.detailsUrl}`);
  }

  if (annotations && annotations.length > 0) {
    lines.push("");
    lines.push(formatAnnotations(annotations));
  }

  if (compactedLog) {
    lines.push("");
    lines.push(compactedLog);
  }

  return lines.join("\n");
}

function formatFixResponse(
  checkRuns: PullRequestCheckRun[],
  compactedLogs: Record<string, string>,
  annotations: Record<string, CheckAnnotation[]>,
): FixChecksResponse {
  const noun = checkRuns.length === 1 ? "check is" : "checks are";
  const names = checkRuns.map((run) => run.name).join(", ");

  return {
    prompt: `# Fix Failing Checks\n\nThe following ${noun} failing on this pull request: ${names}. Review the attached snippets, identify the root cause, and push a fix.`,
    snippets: checkRuns.map((run, index) => ({
      filename: formatSnippetFilename(run, index),
      content: formatSnippetContent(
        run,
        run.id > 0 ? compactedLogs[String(run.id)] : undefined,
        run.id > 0 ? annotations[String(run.id)] : undefined,
      ),
    })),
  };
}

// ── Log compaction via LLM ──────────────────────────────────────────────

async function compactLog(rawLog: string): Promise<string> {
  // For short logs, no point running through an LLM — they're already small
  // enough to include in full.
  if (rawLog.length <= 4000) {
    return rawLog;
  }

  // Truncate input if it exceeds what we want to send to the LLM. Take the
  // first portion and the last portion so the model sees both setup and the
  // final exit status.
  let logInput = rawLog;
  if (rawLog.length > MAX_RAW_LOG_INPUT) {
    const half = Math.floor(MAX_RAW_LOG_INPUT / 2);
    const omitted = rawLog.length - MAX_RAW_LOG_INPUT;
    logInput = `${rawLog.slice(0, half)}\n\n... (${omitted} characters omitted) ...\n\n${rawLog.slice(-half)}`;
  }

  const result = await generateText({
    model: gateway("anthropic/claude-haiku-4.5"),
    system: LOG_SUMMARIZATION_PROMPT,
    prompt: logInput,
  });

  return result.text;
}

// ── Route handler ───────────────────────────────────────────────────────

/**
 * Builds a "fix failing checks" prompt plus native snippet attachments.
 *
 * For each failing check we fetch:
 *   1. **Annotations** via `checks.listAnnotationsForCheckRun` — structured
 *      error data with file paths and line numbers (highest signal).
 *   2. **Raw job logs** via `actions.downloadJobLogsForWorkflowRun` — then
 *      compacted by a lightweight LLM call that strips CI noise and preserves
 *      the actual errors, stack traces, and exit status.
 *
 * Requires the user's GitHub token with `actions: read` and `checks: read` permissions.
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
  const compactedLogs: Record<string, string> = {};
  const allAnnotations: Record<string, CheckAnnotation[]> = {};

  if (runsWithIds.length > 0) {
    const token = await getUserGitHubToken(authResult.userId);
    if (!token) {
      return Response.json(
        formatFixResponse(checkRuns, compactedLogs, allAnnotations),
      );
    }

    const octokit = new Octokit({ auth: token });
    const owner = sessionRecord.repoOwner;
    const repo = sessionRecord.repoName;

    await Promise.all(
      runsWithIds.map(async (run) => {
        const runId = String(run.id);

        // Fetch annotations and raw logs in parallel
        const [annotations, rawLog] = await Promise.all([
          octokit.rest.checks
            .listAnnotations({
              owner,
              repo,
              check_run_id: run.id,
              per_page: 50,
            })
            .then((res) => res.data as CheckAnnotation[])
            .catch(() => [] as CheckAnnotation[]),

          octokit.rest.actions
            .downloadJobLogsForWorkflowRun({
              owner,
              repo,
              job_id: run.id,
            })
            .then((res) =>
              typeof res.data === "string" ? res.data : String(res.data),
            )
            .catch(() => UNABLE_TO_FETCH_LOGS),
        ]);

        allAnnotations[runId] = annotations;

        // Compact the log via LLM (or pass through if short / unavailable)
        if (rawLog === UNABLE_TO_FETCH_LOGS) {
          compactedLogs[runId] = rawLog;
        } else {
          try {
            compactedLogs[runId] = await compactLog(rawLog);
          } catch {
            // If the LLM call fails, fall back to raw log with basic truncation
            compactedLogs[runId] =
              rawLog.length > 16_000
                ? `${rawLog.slice(0, 8000)}\n\n... (${rawLog.length - 16_000} characters omitted) ...\n\n${rawLog.slice(-8000)}`
                : rawLog;
          }
        }
      }),
    );
  }

  return Response.json(
    formatFixResponse(checkRuns, compactedLogs, allAnnotations),
  );
}
