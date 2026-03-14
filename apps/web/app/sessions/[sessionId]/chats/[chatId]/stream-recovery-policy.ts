import type { ChatUiStatus } from "@/lib/chat-streaming-state";

export const STREAM_RECOVERY_STALL_MS = 4_000;
export const STREAM_RECOVERY_MIN_INTERVAL_MS = 8_000;

export type ChatStreamingProbeResponse = {
  chats: { id: string; isStreaming: boolean }[];
};

export type StreamRecoveryDecision = "none" | "retry-error" | "probe";

export function getStreamRecoveryDecision(options: {
  now: number;
  lastRecoveryAt: number;
  status: ChatUiStatus;
  hasAssistantRenderableContent: boolean;
  inFlightStartedAt: number | null;
  isProbeInFlight: boolean;
  minIntervalMs?: number;
  stallMs?: number;
}): StreamRecoveryDecision {
  const {
    now,
    lastRecoveryAt,
    status,
    hasAssistantRenderableContent,
    inFlightStartedAt,
    isProbeInFlight,
    minIntervalMs = STREAM_RECOVERY_MIN_INTERVAL_MS,
    stallMs = STREAM_RECOVERY_STALL_MS,
  } = options;

  if (now - lastRecoveryAt < minIntervalMs) {
    return "none";
  }

  if (status === "error") {
    return "retry-error";
  }

  if (status !== "submitted" || hasAssistantRenderableContent) {
    return "none";
  }

  if (inFlightStartedAt === null || now - inFlightStartedAt < stallMs) {
    return "none";
  }

  if (isProbeInFlight) {
    return "none";
  }

  return "probe";
}

export function shouldScheduleStallRecovery(options: {
  isChatInFlight: boolean;
  hasAssistantRenderableContent: boolean;
  isDocumentVisible: boolean;
}): boolean {
  const { isChatInFlight, hasAssistantRenderableContent, isDocumentVisible } =
    options;

  return isChatInFlight && !hasAssistantRenderableContent && isDocumentVisible;
}

export function getStreamRecoveryDelayMs(options: {
  now: number;
  inFlightStartedAt: number | null;
  stallMs?: number;
}): number {
  const {
    now,
    inFlightStartedAt,
    stallMs = STREAM_RECOVERY_STALL_MS,
  } = options;
  const elapsed = inFlightStartedAt === null ? 0 : now - inFlightStartedAt;
  return Math.max(0, stallMs - elapsed);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isChatStreamingProbeResponse(
  value: unknown,
): value is ChatStreamingProbeResponse {
  if (!isObjectRecord(value)) {
    return false;
  }

  const chats = value["chats"];
  if (!Array.isArray(chats)) {
    return false;
  }

  return chats.every(
    (chat) =>
      isObjectRecord(chat) &&
      typeof chat["id"] === "string" &&
      typeof chat["isStreaming"] === "boolean",
  );
}
