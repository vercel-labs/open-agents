"use client";

import { useState, useMemo, useCallback } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleDotDashed,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import type {
  PullRequestCheckRun,
  PullRequestCheckState,
} from "@/lib/github/client";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types & constants                                                  */
/* ------------------------------------------------------------------ */

const stateOrder: Record<PullRequestCheckState, number> = {
  failed: 0,
  pending: 1,
  passed: 2,
};

function groupLabel(state: PullRequestCheckState, count: number): string {
  const s = count === 1 ? "" : "s";
  switch (state) {
    case "failed":
      return `${count} failing check${s}`;
    case "pending":
      return `${count} pending check${s}`;
    case "passed":
      return `${count} passing check${s}`;
  }
}

/* ------------------------------------------------------------------ */
/*  Header status icon                                                 */
/*  - All passed  → solid green circle with white check                */
/*  - All failed  → solid red circle with white X                      */
/*  - Mixed/split → outline pie-chart–style ring with breakdown        */
/* ------------------------------------------------------------------ */

function HeaderStatusIcon({
  passed,
  failed,
  pending,
  total,
}: {
  passed: number;
  failed: number;
  pending: number;
  total: number;
}) {
  if (failed === 0 && pending === 0) {
    // All passing — solid green circle, white check
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 dark:bg-emerald-500">
        <Check className="h-3 w-3 text-white" strokeWidth={3} />
      </span>
    );
  }

  if (passed === 0 && pending === 0) {
    // All failing — solid red circle, white X
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive">
        <X className="h-3 w-3 text-white" strokeWidth={3} />
      </span>
    );
  }

  // Mixed — SVG pie/ring chart
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const segments = [
    { count: failed, color: "var(--color-destructive, #ef4444)" },
    { count: pending, color: "var(--color-amber-500, #f59e0b)" },
    { count: passed, color: "var(--color-emerald-500, #10b981)" },
  ];

  let offset = 0;
  const arcs = segments
    .filter((s) => s.count > 0)
    .map((s) => {
      const length = (s.count / total) * circumference;
      const arc = { ...s, length, offset };
      offset += length;
      return arc;
    });

  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      className="shrink-0"
      aria-hidden
    >
      {arcs.map((arc, i) => (
        <circle
          key={i}
          cx="10"
          cy="10"
          r={radius}
          fill="none"
          stroke={arc.color}
          strokeWidth="3"
          strokeDasharray={`${arc.length} ${circumference - arc.length}`}
          strokeDashoffset={-arc.offset}
          transform="rotate(-90 10 10)"
        />
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Individual check row icon                                          */
/*  - passed  → simple check (✓)                                       */
/*  - failed  → simple X                                               */
/*  - pending → spinner                                                */
/* ------------------------------------------------------------------ */

function CheckStateIcon({
  state,
  className,
}: {
  state: PullRequestCheckState;
  className?: string;
}) {
  if (state === "passed") {
    return (
      <Check
        className={cn(
          "h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500",
          className,
        )}
        strokeWidth={2.5}
      />
    );
  }
  if (state === "pending") {
    return (
      <CircleDotDashed
        className={cn(
          "h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500",
          className,
        )}
      />
    );
  }
  return (
    <X
      className={cn("h-4 w-4 shrink-0 text-destructive", className)}
      strokeWidth={2.5}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Single check row                                                   */
/* ------------------------------------------------------------------ */

function CheckRunRow({ checkRun }: { checkRun: PullRequestCheckRun }) {
  const inner = (
    <div className="flex min-w-0 items-center gap-2 py-0.5">
      <CheckStateIcon state={checkRun.state} />
      <span
        className={cn(
          "truncate text-sm text-foreground",
          checkRun.detailsUrl &&
            "group-hover/check:underline group-hover/check:underline-offset-2",
        )}
      >
        {checkRun.name}
      </span>
    </div>
  );

  if (checkRun.detailsUrl) {
    return (
      /* oxlint-disable-next-line nextjs/no-html-link-for-pages */
      <a
        href={checkRun.detailsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="group/check block"
        aria-label={`Open details for ${checkRun.name}`}
      >
        {inner}
      </a>
    );
  }

  return inner;
}

/* ------------------------------------------------------------------ */
/*  Collapsible group accordion                                        */
/* ------------------------------------------------------------------ */

function GroupSection({
  state,
  checkRuns,
  defaultOpen,
  trailing,
}: {
  state: PullRequestCheckState;
  checkRuns: PullRequestCheckRun[];
  defaultOpen: boolean;
  trailing?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate">
            {groupLabel(state, checkRuns.length)}
          </span>
        </button>
        {trailing && <div className="shrink-0">{trailing}</div>}
      </div>
      {open && (
        <ul className="ml-4 space-y-0.5">
          {checkRuns.map((cr, i) => (
            <li key={`${cr.name}-${cr.detailsUrl ?? "no-url"}-${i}`}>
              <CheckRunRow checkRun={cr} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Fix errors button with loading state                               */
/* ------------------------------------------------------------------ */

function FixErrorsButton({
  disabled,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => Promise<void> | void;
}) {
  const [isFixing, setIsFixing] = useState(false);

  const handleClick = useCallback(async () => {
    if (isFixing) return;
    setIsFixing(true);
    try {
      await onClick();
    } finally {
      setIsFixing(false);
    }
  }, [isFixing, onClick]);

  return (
    <button
      type="button"
      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      disabled={disabled || isFixing}
      title={
        disabled
          ? "Disabled while the agent is working"
          : isFixing
            ? "Analyzing logs…"
            : undefined
      }
      onClick={() => void handleClick()}
    >
      {isFixing ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Sparkles className="h-3 w-3" />
      )}
      {isFixing ? "Analyzing logs…" : "Fix errors"}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

interface CheckRunsListProps {
  checkRuns: PullRequestCheckRun[];
  checks?: {
    passed: number;
    pending: number;
    failed: number;
  };
  /** Called when the user clicks refresh */
  onRefresh?: () => void;
  isRefreshing?: boolean;
  /** True on initial load before any data arrives */
  isLoading?: boolean;
  /** Disable the fix action without hiding it */
  fixChecksDisabled?: boolean;
  /** Called when the user clicks "Fix errors" — receives all failing check runs */
  onFixChecks?: (failedRuns: PullRequestCheckRun[]) => Promise<void> | void;
}

export function CheckRunsList({
  checkRuns,
  checks,
  onRefresh,
  isRefreshing,
  isLoading,
  fixChecksDisabled = false,
  onFixChecks,
}: CheckRunsListProps) {
  const passed =
    checks?.passed ?? checkRuns.filter((c) => c.state === "passed").length;
  const pending =
    checks?.pending ?? checkRuns.filter((c) => c.state === "pending").length;
  const failed =
    checks?.failed ?? checkRuns.filter((c) => c.state === "failed").length;
  const total = passed + pending + failed;

  // Always start open so checks are visible in the panel
  const [detailsOpen, setDetailsOpen] = useState(true);

  // Count distinct states present — auto-group when > 1
  const distinctStates = useMemo(() => {
    const s = new Set(checkRuns.map((c) => c.state));
    return s.size;
  }, [checkRuns]);

  const shouldGroup = distinctStates > 1;

  const sorted = useMemo(
    () =>
      [...checkRuns].sort((a, b) => stateOrder[a.state] - stateOrder[b.state]),
    [checkRuns],
  );

  const grouped = useMemo(() => {
    const groups: Partial<
      Record<PullRequestCheckState, PullRequestCheckRun[]>
    > = {};
    for (const cr of sorted) {
      (groups[cr.state] ??= []).push(cr);
    }
    return groups;
  }, [sorted]);

  const groupOrder: PullRequestCheckState[] = ["failed", "pending", "passed"];

  if (checkRuns.length === 0 && !isLoading) return null;

  const showLoading = isLoading && checkRuns.length === 0;

  return (
    <div className="rounded-md border border-border bg-muted/40">
      {/* ---- Header row ---- */}
      <div className="flex items-center gap-2.5 p-3">
        {/* Clickable toggle area — takes up remaining space */}
        <button
          type="button"
          onClick={() => {
            if (!showLoading) setDetailsOpen(!detailsOpen);
          }}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2.5",
            showLoading && "cursor-default",
          )}
        >
          {showLoading ? (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <HeaderStatusIcon
              passed={passed}
              failed={failed}
              pending={pending}
              total={total}
            />
          )}

          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="text-sm font-medium text-foreground">Checks</span>
            <span className="truncate text-xs text-muted-foreground">
              {showLoading ? (
                "Loading..."
              ) : (
                <>
                  {passed} passed
                  {pending > 0 && `, ${pending} pending`}
                  {failed > 0 && `, ${failed} failing`}
                </>
              )}
            </span>
          </div>
        </button>

        {/* Action buttons — outside the toggle button */}
        {!showLoading && (
          <div className="flex shrink-0 items-center gap-1">
            {onRefresh && (
              <button
                type="button"
                aria-label="Refresh checks"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => onRefresh()}
              >
                <RefreshCw
                  className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
                />
              </button>
            )}
          </div>
        )}

        {/* Chevron — always on the far right */}
        {!showLoading &&
          (detailsOpen ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          ))}
      </div>

      {/* ---- Expanded detail list ---- */}
      {detailsOpen && !showLoading && (
        <div className="border-t border-border px-3 pb-3 pt-2">
          <div className="max-h-48 overflow-y-auto">
            {shouldGroup ? (
              <div className="space-y-1">
                {groupOrder.map((state) => {
                  const runs = grouped[state];
                  if (!runs || runs.length === 0) return null;
                  return (
                    <GroupSection
                      key={state}
                      state={state}
                      checkRuns={runs}
                      defaultOpen
                      trailing={
                        state === "failed" && onFixChecks ? (
                          <FixErrorsButton
                            disabled={fixChecksDisabled}
                            onClick={() => onFixChecks(runs)}
                          />
                        ) : undefined
                      }
                    />
                  );
                })}
              </div>
            ) : (
              <div>
                {failed > 0 && onFixChecks && (
                  <div className="flex items-center justify-end pb-1">
                    <FixErrorsButton
                      disabled={fixChecksDisabled}
                      onClick={() =>
                        onFixChecks(
                          checkRuns.filter((cr) => cr.state === "failed"),
                        )
                      }
                    />
                  </div>
                )}
                <ul className="space-y-0.5">
                  {sorted.map((cr, i) => (
                    <li key={`${cr.name}-${cr.detailsUrl ?? "no-url"}-${i}`}>
                      <CheckRunRow checkRun={cr} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
