"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface TodoInfo {
  total: number;
  completed: number;
  inProgress: number;
}

function formatElapsedTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (secs === 0) return `${mins}m`;
  return `${mins}m ${secs}s`;
}

export function ToolCallsSummaryBar({
  isExpanded,
  onToggle,
  isStreaming,
  toolCallCount,
  todoInfo,
  durationMs,
  startedAt,
}: {
  isExpanded: boolean;
  onToggle: () => void;
  isStreaming: boolean;
  toolCallCount: number;
  todoInfo: TodoInfo | null;
  /** Final generation duration in ms (for completed messages). */
  durationMs: number | null;
  /** ISO timestamp of when generation started — i.e. the preceding user
   *  message's createdAt — used for a live counter while streaming. */
  startedAt: string | null;
}) {
  // ---------------------------------------------------------------------------
  // Elapsed time logic
  //
  // Completed messages  → use the pre-computed durationMs (accurate, static).
  // Streaming messages  → tick a live counter from startedAt (the moment the
  //                        user sent their message).
  // ---------------------------------------------------------------------------
  const startMs = startedAt ? new Date(startedAt).getTime() : null;

  const computeLiveElapsed = () =>
    startMs != null
      ? Math.max(0, Math.floor((Date.now() - startMs) / 1000))
      : 0;

  const [liveElapsed, setLiveElapsed] = useState(computeLiveElapsed);

  useEffect(() => {
    if (!isStreaming) return;

    setLiveElapsed(computeLiveElapsed());
    const interval = setInterval(() => {
      setLiveElapsed(computeLiveElapsed());
    }, 1000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable per startMs
  }, [isStreaming, startMs]);

  // Pick the right elapsed value.
  // When streaming ends for messages created during this session, durationMs
  // will be null (it's only computed server-side for initial DB messages).
  // Fall back to liveElapsed so the timer freezes at the last ticked value
  // instead of dropping to 0.
  const elapsedSeconds = isStreaming
    ? liveElapsed
    : durationMs != null
      ? Math.max(0, Math.round(durationMs / 1000))
      : liveElapsed;

  // Build the summary segments
  const segments: string[] = [];

  if (elapsedSeconds > 0) {
    segments.push(formatElapsedTime(elapsedSeconds));
  }

  if (toolCallCount > 0) {
    segments.push(
      `${toolCallCount} tool call${toolCallCount !== 1 ? "s" : ""}`,
    );
  }

  if (todoInfo && todoInfo.total > 0) {
    const todoLabel = `Todo ${todoInfo.completed}/${todoInfo.total}`;
    if (todoInfo.inProgress > 0) {
      segments.push(`${todoLabel} (${todoInfo.inProgress} active)`);
    } else {
      segments.push(todoLabel);
    }
  }

  return (
    <div className="my-1.5 border border-transparent py-0.5">
      <button
        type="button"
        onClick={onToggle}
        className="group inline-flex items-center gap-2 rounded-md py-0.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="flex size-3.5 shrink-0 items-center justify-center">
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              isStreaming
                ? "animate-pulse bg-muted-foreground"
                : "bg-muted-foreground/50",
            )}
          />
        </span>
        <span className="leading-none">
          {isStreaming ? "Working…" : "Worked"}
          {segments.length > 0 && (
            <>
              {segments.map((segment, i) => (
                <span key={i}>
                  <span className="text-muted-foreground/40"> · </span>
                  {segment}
                </span>
              ))}
            </>
          )}
        </span>
        <ChevronRight
          className={cn(
            "h-3 w-3 text-muted-foreground/50 transition-transform duration-200 ease-out motion-reduce:transition-none",
            isExpanded && "rotate-90",
          )}
        />
      </button>
    </div>
  );
}
