"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
}: {
  isExpanded: boolean;
  onToggle: () => void;
  isStreaming: boolean;
  toolCallCount: number;
  todoInfo: TodoInfo | null;
}) {
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isStreaming) {
      if (startTimeRef.current !== null) {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
      return;
    }

    if (startTimeRef.current === null) {
      startTimeRef.current = Date.now();
    }

    const interval = setInterval(() => {
      setElapsed(
        Math.floor((Date.now() - (startTimeRef.current ?? Date.now())) / 1000),
      );
    }, 1000);

    return () => clearInterval(interval);
  }, [isStreaming]);

  // Build the summary segments
  const segments: string[] = [];

  if (elapsed > 0) {
    segments.push(formatElapsedTime(elapsed));
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
    <div className="flex justify-start">
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
