"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface ThinkingBlockProps {
  text: string;
  isStreaming?: boolean;
}

export function ThinkingBlock({
  text,
  isStreaming = false,
}: ThinkingBlockProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isStreaming) {
      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now();
      }
      intervalRef.current = setInterval(() => {
        setElapsed(
          Math.floor(
            (Date.now() - (startTimeRef.current ?? Date.now())) / 1000,
          ),
        );
      }, 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isStreaming]);

  const hasContent = text.trim().length > 0;

  const formatLabel = () => {
    if (isStreaming) {
      return "Thinking...";
    }
    return elapsed > 0
      ? `Thought for ${elapsed} second${elapsed !== 1 ? "s" : ""}`
      : "Thought";
  };

  return (
    <div className="w-full">
      {hasContent ? (
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className={cn(isStreaming && "animate-pulse")}>
            {formatLabel()}
          </span>
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
      ) : (
        <span
          className={cn(
            "text-sm font-medium text-muted-foreground",
            isStreaming && "animate-pulse",
          )}
        >
          {formatLabel()}
        </span>
      )}
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
