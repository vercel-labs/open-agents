"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ThinkingBlockProps {
  text: string;
  isStreaming?: boolean;
  partCount?: number;
}

export function ThinkingBlock({
  text,
  isStreaming = false,
  partCount = 1,
}: ThinkingBlockProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isActivelyStreaming = isStreaming;

  useEffect(() => {
    if (!isActivelyStreaming) {
      if (startTimeRef.current !== null) {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    }

    if (startTimeRef.current === null) {
      startTimeRef.current = Date.now();
    }

    intervalRef.current = setInterval(() => {
      setElapsed(
        Math.floor((Date.now() - (startTimeRef.current ?? Date.now())) / 1000),
      );
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isActivelyStreaming]);

  const hasContent = text.trim().length > 0;
  const thoughtLabel =
    partCount === 1
      ? "Thought"
      : `${partCount} thought${partCount !== 1 ? "s" : ""}`;

  const formatLabel = () => {
    if (isActivelyStreaming) {
      return "Thinking...";
    }
    return elapsed > 0
      ? `${thoughtLabel} for ${elapsed} second${elapsed !== 1 ? "s" : ""}`
      : thoughtLabel;
  };

  return (
    <div className="w-full min-h-5">
      <button
        type="button"
        onClick={() => {
          if (!hasContent) {
            return;
          }
          setIsOpen((prev) => !prev);
        }}
        className={cn(
          "flex min-h-5 items-center gap-1.5 p-0 text-sm font-medium leading-5 text-muted-foreground",
          hasContent
            ? "transition-colors hover:text-foreground"
            : "cursor-default",
        )}
      >
        <span
          className={cn("leading-5", isActivelyStreaming && "animate-pulse")}
        >
          {formatLabel()}
        </span>
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          {hasContent ? (
            isOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <span className="h-3.5 w-3.5" aria-hidden />
          )}
        </span>
      </button>
      {isOpen && hasContent && (
        <div className="mt-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
            {text}
          </p>
        </div>
      )}
    </div>
  );
}
