"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SharedChatStatusData } from "./shared-chat-status-utils";
import { elapsedSince, formatElapsed } from "./shared-chat-status-utils";

const POLL_INTERVAL_MS = 10_000;
const TICK_INTERVAL_MS = 1_000;

export function SharedChatStatus({
  shareId,
  initialIsStreaming,
  initialLastUserMessageSentAt,
}: {
  shareId: string;
  initialIsStreaming: boolean;
  initialLastUserMessageSentAt: string | null;
}) {
  const [isStreaming, setIsStreaming] = useState(initialIsStreaming);
  const [startedAt, setStartedAt] = useState<string | null>(
    initialIsStreaming ? initialLastUserMessageSentAt : null,
  );
  const [elapsed, setElapsed] = useState(() => elapsedSince(startedAt));

  // Keep a ref to startedAt so the tick interval always reads the latest value.
  const startedAtRef = useRef(startedAt);
  startedAtRef.current = startedAt;

  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;

  // Poll the status endpoint while streaming.
  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/shared/${shareId}/status`);
      if (!res.ok) return;
      const data: SharedChatStatusData = await res.json();
      setIsStreaming(data.isStreaming);
      setStartedAt(data.isStreaming ? data.startedAt : null);
      if (!data.isStreaming) {
        setElapsed(0);
      }
    } catch {
      // Silently ignore transient network errors; next poll will retry.
    }
  }, [shareId]);

  // Set up polling interval (only while streaming).
  useEffect(() => {
    if (!isStreaming) return;
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isStreaming, poll]);

  // Client-side tick for the elapsed timer (once per second while streaming).
  useEffect(() => {
    if (!isStreaming) return;
    const id = setInterval(() => {
      setElapsed(elapsedSince(startedAtRef.current));
    }, TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isStreaming]);

  if (!isStreaming) return null;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-2.5 py-1 text-xs text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin" />
      <span className="font-medium text-foreground">Running</span>
      {startedAt && elapsed > 0 && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <span>{formatElapsed(elapsed)}</span>
        </>
      )}
    </span>
  );
}
