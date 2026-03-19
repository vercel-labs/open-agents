import { CheckCircle2, Clock3, ExternalLink, XCircle } from "lucide-react";
import type { PullRequestCheckRun } from "@/lib/github/client";

function getCheckStateLabel(state: "passed" | "pending" | "failed"): string {
  return state === "passed"
    ? "Passed"
    : state === "pending"
      ? "Pending"
      : "Failing";
}

interface CheckRunsListProps {
  checkRuns: PullRequestCheckRun[];
}

export function CheckRunsList({ checkRuns }: CheckRunsListProps) {
  if (checkRuns.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <p className="mb-2 text-sm font-medium text-foreground">Check details</p>
      <ul className="max-h-40 space-y-1 overflow-y-auto">
        {checkRuns.map((checkRun, index) => (
          <li
            key={`${checkRun.name}-${checkRun.detailsUrl ?? "no-url"}-${index}`}
            className="flex items-center justify-between gap-2 text-sm"
          >
            <div className="flex min-w-0 items-center gap-2">
              {checkRun.state === "passed" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
              ) : checkRun.state === "pending" ? (
                <Clock3 className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0 text-destructive" />
              )}
              <span className="truncate text-foreground">{checkRun.name}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={
                  checkRun.state === "passed"
                    ? "text-xs text-emerald-600 dark:text-emerald-500"
                    : checkRun.state === "pending"
                      ? "text-xs text-amber-600 dark:text-amber-500"
                      : "text-xs text-destructive"
                }
              >
                {getCheckStateLabel(checkRun.state)}
              </span>
              {checkRun.detailsUrl ? (
                /* oxlint-disable-next-line nextjs/no-html-link-for-pages */
                <a
                  href={checkRun.detailsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`Open details for ${checkRun.name}`}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
