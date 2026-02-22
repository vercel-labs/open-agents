import { describe, expect, test } from "bun:test";
import {
  isChatInFlight,
  shouldRefreshAfterReadyTransition,
  shouldShowThinkingIndicator,
} from "./chat-streaming-state";

describe("chat streaming state", () => {
  test("treats submitted and streaming as in-flight", () => {
    expect(isChatInFlight("submitted")).toBe(true);
    expect(isChatInFlight("streaming")).toBe(true);
    expect(isChatInFlight("ready")).toBe(false);
    expect(isChatInFlight("error")).toBe(false);
  });

  test("does not show thinking when submitted already has assistant output", () => {
    expect(
      shouldShowThinkingIndicator({
        status: "submitted",
        hasAssistantRenderableContent: true,
        lastMessageRole: "assistant",
      }),
    ).toBe(false);
  });

  test("shows thinking while in-flight without assistant output", () => {
    expect(
      shouldShowThinkingIndicator({
        status: "submitted",
        hasAssistantRenderableContent: false,
        lastMessageRole: "user",
      }),
    ).toBe(true);

    expect(
      shouldShowThinkingIndicator({
        status: "streaming",
        hasAssistantRenderableContent: false,
        lastMessageRole: "assistant",
      }),
    ).toBe(true);
  });

  test("refreshes route only for submitted to ready transition", () => {
    expect(
      shouldRefreshAfterReadyTransition({
        prevStatus: "submitted",
        status: "ready",
        hasAssistantRenderableContent: true,
      }),
    ).toBe(true);

    expect(
      shouldRefreshAfterReadyTransition({
        prevStatus: "streaming",
        status: "ready",
        hasAssistantRenderableContent: true,
      }),
    ).toBe(false);

    expect(
      shouldRefreshAfterReadyTransition({
        prevStatus: "ready",
        status: "ready",
        hasAssistantRenderableContent: true,
      }),
    ).toBe(false);

    expect(
      shouldRefreshAfterReadyTransition({
        prevStatus: "submitted",
        status: "ready",
        hasAssistantRenderableContent: false,
      }),
    ).toBe(false);
  });
});
