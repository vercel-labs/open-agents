"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { SharedChatStatusData } from "./shared-chat-status-utils";

/** Poll every 3 seconds while streaming so tool calls appear ~live. */
const POLL_INTERVAL_MS = 3_000;

const STATUS_WORDS = [
  "Pondering",
  "Crafting",
  "Vibing",
  "Simmering",
  "Marinating",
  "Philosophising",
  "Ruminating",
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function getStatusWord(seed: string): string {
  return STATUS_WORDS[hashString(seed) % STATUS_WORDS.length];
}

function formatElapsedTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (secs === 0) return `${mins}m`;
  return `${mins}m ${secs}s`;
}

export function SharedChatStatus({
  shareId,
  initialIsStreaming,
  initialLastUserMessageSentAt,
}: {
  shareId: string;
  initialIsStreaming: boolean;
  initialLastUserMessageSentAt: string | null;
}) {
  const router = useRouter();
  const [isStreaming, setIsStreaming] = useState(initialIsStreaming);
  const [startedAt] = useState<string | null>(
    initialIsStreaming ? initialLastUserMessageSentAt : null,
  );

  const startMs = startedAt ? new Date(startedAt).getTime() : null;

  const computeLiveElapsed = () =>
    startMs != null
      ? Math.max(0, Math.floor((Date.now() - startMs) / 1000))
      : 0;

  const [liveElapsed, setLiveElapsed] = useState(computeLiveElapsed);

  // Tick the elapsed counter every second while streaming.
  useEffect(() => {
    if (!isStreaming) return;
    setLiveElapsed(computeLiveElapsed());
    const interval = setInterval(() => {
      setLiveElapsed(computeLiveElapsed());
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable per startMs
  }, [isStreaming, startMs]);

  // Poll the status endpoint while streaming. Refresh server data on every
  // poll so the viewer sees new tool calls / text as it streams in.
  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/shared/${shareId}/status`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data: SharedChatStatusData = await res.json();

      // Always refresh to pull latest messages (shows tool calls live)
      router.refresh();

      if (!data.isStreaming) {
        setIsStreaming(false);
      }
    } catch {
      // Silently ignore transient network errors; next poll will retry.
    }
  }, [shareId, router]);

  // Set up polling interval (only while streaming).
  useEffect(() => {
    if (!isStreaming) return;
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isStreaming, poll]);

  if (!isStreaming) return null;

  const statusWord = getStatusWord(shareId);
  const elapsedLabel = liveElapsed > 0 ? formatElapsedTime(liveElapsed) : null;

  return (
    <div className="my-1.5 border border-transparent py-0.5">
      <div
        className={cn(
          "flex w-full max-w-full items-center gap-2 py-px text-left text-sm tabular-nums text-foreground/90 sm:inline-flex sm:w-auto",
        )}
      >
        <span className="flex size-3.5 shrink-0 items-center justify-center">
          <span className="inline-block size-2 animate-pulse rounded-full bg-muted-foreground" />
        </span>
        <span className="min-w-0 flex-1 animate-pulse overflow-hidden whitespace-nowrap leading-none motion-reduce:animate-none sm:flex-none sm:overflow-visible sm:whitespace-normal">
          {statusWord}…
          {elapsedLabel && (
            <span className="text-muted-foreground/40"> · </span>
          )}
          {elapsedLabel}
        </span>
      </div>
    </div>
  );
}
