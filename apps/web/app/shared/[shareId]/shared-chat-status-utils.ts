/** Pure helpers for the shared chat status badge / timer. */

export type SharedChatStatusData = {
  isStreaming: boolean;
};

/**
 * Format an elapsed duration in milliseconds to a human-readable string.
 * Examples: "<1s", "5s", "1m 30s", "2m".
 */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return "<1s";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

/**
 * Derive the elapsed milliseconds since a given ISO timestamp.
 * Returns 0 if the timestamp is null or in the future.
 */
export function elapsedSince(isoTimestamp: string | null): number {
  if (!isoTimestamp) return 0;
  const diff = Date.now() - new Date(isoTimestamp).getTime();
  return diff > 0 ? diff : 0;
}
