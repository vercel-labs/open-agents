import { describe, expect, test } from "bun:test";
import {
  canAttemptAutoRecovery,
  CHAT_STREAM_RECOVERY_COOLDOWN_MS,
  resolveRetryStrategy,
  shouldResetAutoRecoveryWindow,
} from "./chat-stream-recovery-policy";

describe("chat stream recovery policy", () => {
  test("uses hard retries for manual retry and soft retries for auto retry by default", () => {
    expect(resolveRetryStrategy({ mode: "manual" })).toBe("hard");
    expect(resolveRetryStrategy({ mode: "auto" })).toBe("soft");
  });

  test("respects explicit retry strategy overrides", () => {
    expect(
      resolveRetryStrategy({ mode: "manual", requestedStrategy: "soft" }),
    ).toBe("soft");
    expect(
      resolveRetryStrategy({ mode: "auto", requestedStrategy: "hard" }),
    ).toBe("hard");
  });

  test("blocks auto recovery when a prior attempt is still in-flight", () => {
    expect(
      canAttemptAutoRecovery({
        nowMs: 10_000,
        lastAttemptAtMs: 0,
        isAttemptInFlight: true,
      }),
    ).toBe(false);
  });

  test("enforces cooldown windows for auto recovery attempts", () => {
    expect(
      canAttemptAutoRecovery({
        nowMs: CHAT_STREAM_RECOVERY_COOLDOWN_MS - 1,
        lastAttemptAtMs: 0,
        isAttemptInFlight: false,
      }),
    ).toBe(false);

    expect(
      canAttemptAutoRecovery({
        nowMs: CHAT_STREAM_RECOVERY_COOLDOWN_MS,
        lastAttemptAtMs: 0,
        isAttemptInFlight: false,
      }),
    ).toBe(true);
  });

  test("resets auto recovery cooldown only after forward status transitions", () => {
    expect(
      shouldResetAutoRecoveryWindow({
        previousStatus: null,
        nextStatus: "ready",
      }),
    ).toBe(false);

    expect(
      shouldResetAutoRecoveryWindow({
        previousStatus: "error",
        nextStatus: "error",
      }),
    ).toBe(false);

    expect(
      shouldResetAutoRecoveryWindow({
        previousStatus: "error",
        nextStatus: "submitted",
      }),
    ).toBe(true);

    expect(
      shouldResetAutoRecoveryWindow({
        previousStatus: "streaming",
        nextStatus: "ready",
      }),
    ).toBe(true);

    expect(
      shouldResetAutoRecoveryWindow({
        previousStatus: "submitted",
        nextStatus: "error",
      }),
    ).toBe(false);
  });
});
