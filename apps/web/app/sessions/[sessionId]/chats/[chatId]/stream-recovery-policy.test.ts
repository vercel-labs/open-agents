import { describe, expect, test } from "bun:test";
import {
  STREAM_RECOVERY_MIN_INTERVAL_MS,
  STREAM_RECOVERY_STALL_MS,
  getStreamRecoveryDecision,
  getStreamRecoveryDelayMs,
  isChatStreamingProbeResponse,
  shouldScheduleStallRecovery,
} from "./stream-recovery-policy";

describe("getStreamRecoveryDecision", () => {
  const now = 50_000;

  test("blocks recovery while cooldown is active", () => {
    const decision = getStreamRecoveryDecision({
      now,
      lastRecoveryAt: now - STREAM_RECOVERY_MIN_INTERVAL_MS + 1,
      status: "error",
      hasAssistantRenderableContent: false,
      inFlightStartedAt: now - STREAM_RECOVERY_STALL_MS,
      isProbeInFlight: false,
    });

    expect(decision).toBe("none");
  });

  test("retries immediately when in error after cooldown", () => {
    const decision = getStreamRecoveryDecision({
      now,
      lastRecoveryAt: now - STREAM_RECOVERY_MIN_INTERVAL_MS,
      status: "error",
      hasAssistantRenderableContent: false,
      inFlightStartedAt: now - STREAM_RECOVERY_STALL_MS,
      isProbeInFlight: false,
    });

    expect(decision).toBe("retry-error");
  });

  test("does not probe unless chat is still submitted with no content", () => {
    const decision = getStreamRecoveryDecision({
      now,
      lastRecoveryAt: now - STREAM_RECOVERY_MIN_INTERVAL_MS,
      status: "streaming",
      hasAssistantRenderableContent: false,
      inFlightStartedAt: now - STREAM_RECOVERY_STALL_MS,
      isProbeInFlight: false,
    });

    expect(decision).toBe("none");
  });

  test("does not probe if assistant content is already visible", () => {
    const decision = getStreamRecoveryDecision({
      now,
      lastRecoveryAt: now - STREAM_RECOVERY_MIN_INTERVAL_MS,
      status: "submitted",
      hasAssistantRenderableContent: true,
      inFlightStartedAt: now - STREAM_RECOVERY_STALL_MS,
      isProbeInFlight: false,
    });

    expect(decision).toBe("none");
  });

  test("does not probe before the stall threshold is reached", () => {
    const decision = getStreamRecoveryDecision({
      now,
      lastRecoveryAt: now - STREAM_RECOVERY_MIN_INTERVAL_MS,
      status: "submitted",
      hasAssistantRenderableContent: false,
      inFlightStartedAt: now - STREAM_RECOVERY_STALL_MS + 1,
      isProbeInFlight: false,
    });

    expect(decision).toBe("none");
  });

  test("does not probe while another probe is in flight", () => {
    const decision = getStreamRecoveryDecision({
      now,
      lastRecoveryAt: now - STREAM_RECOVERY_MIN_INTERVAL_MS,
      status: "submitted",
      hasAssistantRenderableContent: false,
      inFlightStartedAt: now - STREAM_RECOVERY_STALL_MS,
      isProbeInFlight: true,
    });

    expect(decision).toBe("none");
  });

  test("probes when submitted stream appears stalled", () => {
    const decision = getStreamRecoveryDecision({
      now,
      lastRecoveryAt: now - STREAM_RECOVERY_MIN_INTERVAL_MS,
      status: "submitted",
      hasAssistantRenderableContent: false,
      inFlightStartedAt: now - STREAM_RECOVERY_STALL_MS,
      isProbeInFlight: false,
    });

    expect(decision).toBe("probe");
  });

  test("probes on visibility recovery when chat is ready", () => {
    const decision = getStreamRecoveryDecision({
      now,
      lastRecoveryAt: now - STREAM_RECOVERY_MIN_INTERVAL_MS,
      status: "ready",
      hasAssistantRenderableContent: true,
      inFlightStartedAt: null,
      isProbeInFlight: false,
      isVisibilityRecovery: true,
    });

    expect(decision).toBe("probe");
  });

  test("does not probe on visibility recovery when already probing", () => {
    const decision = getStreamRecoveryDecision({
      now,
      lastRecoveryAt: now - STREAM_RECOVERY_MIN_INTERVAL_MS,
      status: "ready",
      hasAssistantRenderableContent: true,
      inFlightStartedAt: null,
      isProbeInFlight: true,
      isVisibilityRecovery: true,
    });

    expect(decision).toBe("none");
  });

  test("does not probe ready status without visibility flag", () => {
    const decision = getStreamRecoveryDecision({
      now,
      lastRecoveryAt: now - STREAM_RECOVERY_MIN_INTERVAL_MS,
      status: "ready",
      hasAssistantRenderableContent: true,
      inFlightStartedAt: null,
      isProbeInFlight: false,
      isVisibilityRecovery: false,
    });

    expect(decision).toBe("none");
  });
});

describe("shouldScheduleStallRecovery", () => {
  test("requires in-flight status, no content, and visible document", () => {
    expect(
      shouldScheduleStallRecovery({
        isChatInFlight: false,
        hasAssistantRenderableContent: false,
        isDocumentVisible: true,
      }),
    ).toBe(false);

    expect(
      shouldScheduleStallRecovery({
        isChatInFlight: true,
        hasAssistantRenderableContent: true,
        isDocumentVisible: true,
      }),
    ).toBe(false);

    expect(
      shouldScheduleStallRecovery({
        isChatInFlight: true,
        hasAssistantRenderableContent: false,
        isDocumentVisible: false,
      }),
    ).toBe(false);

    expect(
      shouldScheduleStallRecovery({
        isChatInFlight: true,
        hasAssistantRenderableContent: false,
        isDocumentVisible: true,
      }),
    ).toBe(true);
  });
});

describe("getStreamRecoveryDelayMs", () => {
  test("returns full stall delay when start time is unknown", () => {
    expect(
      getStreamRecoveryDelayMs({
        now: 30_000,
        inFlightStartedAt: null,
      }),
    ).toBe(STREAM_RECOVERY_STALL_MS);
  });

  test("returns remaining stall delay when turn is in progress", () => {
    expect(
      getStreamRecoveryDelayMs({
        now: 30_000,
        inFlightStartedAt: 27_500,
      }),
    ).toBe(1_500);
  });

  test("clamps delay to zero after stall threshold", () => {
    expect(
      getStreamRecoveryDelayMs({
        now: 30_000,
        inFlightStartedAt: 10_000,
      }),
    ).toBe(0);
  });
});

describe("isChatStreamingProbeResponse", () => {
  test("accepts valid probe payload", () => {
    expect(
      isChatStreamingProbeResponse({
        chats: [
          { id: "chat-1", isStreaming: true },
          { id: "chat-2", isStreaming: false },
        ],
      }),
    ).toBe(true);
  });

  test("rejects invalid payloads", () => {
    expect(isChatStreamingProbeResponse(null)).toBe(false);
    expect(isChatStreamingProbeResponse({})).toBe(false);
    expect(
      isChatStreamingProbeResponse({
        chats: [{ id: "chat-1", isStreaming: "yes" }],
      }),
    ).toBe(false);
  });
});
