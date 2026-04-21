import { describe, expect, mock, test } from "bun:test";

mock.module("ai", () => ({
  isToolUIPart: (part: { type?: unknown }) =>
    typeof part.type === "string" && part.type.startsWith("tool-"),
  isReasoningUIPart: (part: { type?: unknown }) => part.type === "reasoning",
}));

const {
  getGitFinalizationState,
  getNavbarGitActionState,
  hasRenderableAssistantPart,
  isChatInFlight,
  shouldKeepCollapsedReasoningStreaming,
  shouldRefreshAfterReadyTransition,
  shouldRenderGitDataPart,
  shouldShowThinkingIndicator,
  shouldUseChatListStreamingState,
} = await import("./chat-streaming-state");

type ChatMessage = Parameters<typeof getNavbarGitActionState>[0][number];

function assistantMessage(parts: unknown[]): ChatMessage {
  return {
    id: `assistant-${parts.length}`,
    role: "assistant",
    parts,
  } as unknown as ChatMessage;
}

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
    const skippedCommitPart = {
      type: "data-commit",
      data: { status: "skipped" },
    } as unknown as AssistantPart;

    expect(hasRenderableAssistantPart(emptyTextPart)).toBe(false);
    expect(hasRenderableAssistantPart(textPart)).toBe(true);
    expect(hasRenderableAssistantPart(streamingReasoningPart)).toBe(true);
    expect(hasRenderableAssistantPart(completedReasoningPart)).toBe(false);
    expect(hasRenderableAssistantPart(completedReasoningWithTextPart)).toBe(
      true,
    );
    expect(hasRenderableAssistantPart(gitDataPart)).toBe(true);
    expect(hasRenderableAssistantPart(skippedCommitPart)).toBe(false);
    expect(
      shouldRenderGitDataPart(
        skippedCommitPart as Parameters<typeof shouldRenderGitDataPart>[0],
      ),
    ).toBe(false);
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

  test("reuses chat list streaming state while reconnecting to a user-turn stream", () => {
    expect(
      shouldUseChatListStreamingState({
        status: "ready",
        hasChatListStreaming: true,
        userStopped: false,
        hasAssistantRenderableContent: false,
        lastMessageRole: "user",
      }),
    ).toBe(true);
  });

  test("reuses chat list streaming state for empty assistant placeholders only", () => {
    expect(
      shouldUseChatListStreamingState({
        status: "ready",
        hasChatListStreaming: true,
        userStopped: false,
        hasAssistantRenderableContent: false,
        lastMessageRole: "assistant",
      }),
    ).toBe(true);

    expect(
      shouldUseChatListStreamingState({
        status: "ready",
        hasChatListStreaming: true,
        userStopped: false,
        hasAssistantRenderableContent: true,
        lastMessageRole: "assistant",
      }),
    ).toBe(false);
  });

  test("ignores chat list streaming fallback after stop or once local stream is active", () => {
    expect(
      shouldUseChatListStreamingState({
        status: "ready",
        hasChatListStreaming: true,
        userStopped: true,
        hasAssistantRenderableContent: false,
        lastMessageRole: "user",
      }),
    ).toBe(false);

    expect(
      shouldUseChatListStreamingState({
        status: "streaming",
        hasChatListStreaming: true,
        userStopped: false,
        hasAssistantRenderableContent: false,
        lastMessageRole: "user",
      }),
    ).toBe(false);
  });

  test("derives pending commit state from the latest assistant git message", () => {
    expect(
      getNavbarGitActionState([
        assistantMessage([
          {
            type: "data-commit",
            id: "commit-1",
            data: { status: "pending" },
          },
        ]),
      ]),
    ).toEqual({
      pendingAction: "commit",
      label: "Creating commit…",
      latestCommitPart: {
        type: "data-commit",
        id: "commit-1",
        data: { status: "pending" },
      },
      latestPrPart: null,
    });
  });

  test("prefers pending pull request state over earlier commit state in the same message", () => {
    expect(
      getNavbarGitActionState([
        assistantMessage([
          {
            type: "data-commit",
            id: "commit-1",
            data: { status: "success", pushed: true },
          },
          {
            type: "data-pr",
            id: "pr-1",
            data: { status: "pending" },
          },
        ]),
      ]),
    ).toEqual({
      pendingAction: "pr",
      label: "Creating pull request…",
      latestCommitPart: {
        type: "data-commit",
        id: "commit-1",
        data: { status: "success", pushed: true },
      },
      latestPrPart: {
        type: "data-pr",
        id: "pr-1",
        data: { status: "pending" },
      },
    });
  });

  test("falls back to idle for resolved git states and ignores older pending messages", () => {
    expect(
      getNavbarGitActionState([
        assistantMessage([
          {
            type: "data-commit",
            id: "commit-1",
            data: { status: "pending" },
          },
        ]),
        assistantMessage([
          {
            type: "data-pr",
            id: "pr-1",
            data: { status: "success", prNumber: 12 },
          },
        ]),
      ]),
    ).toEqual({
      pendingAction: null,
      label: null,
      latestCommitPart: null,
      latestPrPart: {
        type: "data-pr",
        id: "pr-1",
        data: { status: "success", prNumber: 12 },
      },
    });
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
  });
});
