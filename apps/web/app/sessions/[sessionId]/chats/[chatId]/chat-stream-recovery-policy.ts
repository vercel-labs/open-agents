export const CHAT_STREAM_STALL_THRESHOLD_MS = 4_000;
export const CHAT_STREAM_RECOVERY_COOLDOWN_MS = 8_000;

export type ChatStreamRetryStrategy = "hard" | "soft";
export type ChatStreamRetryMode = "manual" | "auto";
export type ChatStreamStatus = "submitted" | "streaming" | "ready" | "error";

export function resolveRetryStrategy({
  mode,
  requestedStrategy,
}: {
  mode: ChatStreamRetryMode;
  requestedStrategy?: ChatStreamRetryStrategy;
}): ChatStreamRetryStrategy {
  if (requestedStrategy) {
    return requestedStrategy;
  }

  return mode === "auto" ? "soft" : "hard";
}

export function canAttemptAutoRecovery({
  nowMs,
  lastAttemptAtMs,
  cooldownMs = CHAT_STREAM_RECOVERY_COOLDOWN_MS,
  isAttemptInFlight,
}: {
  nowMs: number;
  lastAttemptAtMs: number;
  cooldownMs?: number;
  isAttemptInFlight: boolean;
}): boolean {
  if (isAttemptInFlight) {
    return false;
  }

  return nowMs - lastAttemptAtMs >= cooldownMs;
}

export function shouldResetAutoRecoveryWindow({
  previousStatus,
  nextStatus,
}: {
  previousStatus: ChatStreamStatus | null;
  nextStatus: ChatStreamStatus;
}): boolean {
  if (previousStatus === null || previousStatus === nextStatus) {
    return false;
  }

  return (
    nextStatus === "submitted" ||
    nextStatus === "streaming" ||
    nextStatus === "ready"
  );
}
