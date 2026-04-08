import { describe, expect, mock, test } from "bun:test";

mock.module("ai", () => ({
  isToolUIPart: (part: { type?: unknown }) =>
    typeof part.type === "string" && part.type.startsWith("tool-"),
  isReasoningUIPart: (part: { type?: unknown }) => part.type === "reasoning",
}));

const {
  getGitFinalizationState,
  hasRenderableAssistantPart,
  isChatInFlight,
  shouldKeepCollapsedReasoningStreaming,
  shouldRefreshAfterReadyTransition,
  shouldShowThinkingIndicator,
} = await import("./chat-streaming-state");

describe("chat streaming state", () => {
  test("treats submitted and streaming as in-flight", () => {
    expect(isChatInFlight("submitted")).toBe(true);
    expect(isChatInFlight("streaming")).toBe(true);
    expect(isChatInFlight("ready")).toBe(false);
    expect(isChatInFlight("error")).toBe(false);
  });

  test("treats only visibly renderable assistant parts as content", () => {
    type AssistantPart = Parameters<typeof hasRenderableAssistantPart>[0];

    const emptyTextPart = {
      type: "text",
      text: "",
    } as unknown as AssistantPart;
    const textPart = {
      type: "text",
      text: "Hello",
    } as unknown as AssistantPart;
    const streamingReasoningPart = {
      type: "reasoning",
      text: "",
      state: "streaming",
    } as unknown as AssistantPart;
    const completedReasoningPart = {
      type: "reasoning",
      text: "",
      state: "done",
    } as unknown as AssistantPart;
    const completedReasoningWithTextPart = {
      type: "reasoning",
      text: "Planning the next step",
      state: "done",
    } as unknown as AssistantPart;
    const gitDataPart = {
      type: "data-commit",
      data: { status: "pending" },
    } as unknown as AssistantPart;

    expect(hasRenderableAssistantPart(emptyTextPart)).toBe(false);
    expect(hasRenderableAssistantPart(textPart)).toBe(true);
    expect(hasRenderableAssistantPart(streamingReasoningPart)).toBe(true);
    expect(hasRenderableAssistantPart(completedReasoningPart)).toBe(false);
    expect(hasRenderableAssistantPart(completedReasoningWithTextPart)).toBe(
      true,
    );
    expect(hasRenderableAssistantPart(gitDataPart)).toBe(true);
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

  test("detects non-cancellable git finalization once git data arrives on an in-flight assistant message", () => {
    expect(
      getGitFinalizationState({
        status: "streaming",
        lastMessageRole: "assistant",
        lastMessageParts: [
          {
            type: "data-commit",
            data: { status: "pending" },
          } as unknown as Parameters<typeof hasRenderableAssistantPart>[0],
        ],
      }),
    ).toEqual({
      isFinalizing: true,
      label: "Creating commit…",
    });

    expect(
      getGitFinalizationState({
        status: "streaming",
        lastMessageRole: "assistant",
        lastMessageParts: [
          {
            type: "data-commit",
            data: { status: "success" },
          } as unknown as Parameters<typeof hasRenderableAssistantPart>[0],
          {
            type: "data-pr",
            data: { status: "pending" },
          } as unknown as Parameters<typeof hasRenderableAssistantPart>[0],
        ],
      }),
    ).toEqual({
      isFinalizing: true,
      label: "Creating pull request…",
    });

    expect(
      getGitFinalizationState({
        status: "streaming",
        lastMessageRole: "assistant",
        lastMessageParts: [
          {
            type: "data-commit",
            data: { status: "success" },
          } as unknown as Parameters<typeof hasRenderableAssistantPart>[0],
        ],
      }),
    ).toEqual({
      isFinalizing: true,
      label: "Finalizing git actions…",
    });
  });

  test("does not treat stale git data on a non-streaming message as finalization", () => {
    expect(
      getGitFinalizationState({
        status: "ready",
        lastMessageRole: "assistant",
        lastMessageParts: [
          {
            type: "data-commit",
            data: { status: "pending" },
          } as unknown as Parameters<typeof hasRenderableAssistantPart>[0],
        ],
      }),
    ).toEqual({
      isFinalizing: false,
      label: null,
    });
  });

  test("keeps collapsed reasoning blocks streaming until later content appears", () => {
    expect(
      shouldKeepCollapsedReasoningStreaming({
        isMessageStreaming: true,
        hasStreamingReasoningPart: false,
        hasRenderableContentAfterGroup: false,
      }),
    ).toBe(true);

    expect(
      shouldKeepCollapsedReasoningStreaming({
        isMessageStreaming: true,
        hasStreamingReasoningPart: false,
        hasRenderableContentAfterGroup: true,
      }),
    ).toBe(false);

    expect(
      shouldKeepCollapsedReasoningStreaming({
        isMessageStreaming: true,
        hasStreamingReasoningPart: true,
        hasRenderableContentAfterGroup: true,
      }),
    ).toBe(true);

    expect(
      shouldKeepCollapsedReasoningStreaming({
        isMessageStreaming: false,
        hasStreamingReasoningPart: false,
        hasRenderableContentAfterGroup: false,
      }),
    ).toBe(false);
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
