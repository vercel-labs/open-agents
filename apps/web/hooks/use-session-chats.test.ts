import { describe, expect, test } from "bun:test";
import {
  applySessionSummary,
  applySessionSummaryFromChats,
  deriveSessionSummaryFromChats,
  didSessionSummaryChange,
  type SessionChatListItem,
} from "./use-session-chats";

function createChat(
  id: string,
  options?: Partial<Pick<SessionChatListItem, "hasUnread" | "isStreaming">>,
): SessionChatListItem {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id,
    sessionId: "session-1",
    title: `Chat ${id}`,
    modelId: "anthropic/claude-haiku-4.5",
    activeStreamId: null,
    lastAssistantMessageAt: null,
    createdAt: now,
    updatedAt: now,
    hasUnread: options?.hasUnread ?? false,
    isStreaming: options?.isStreaming ?? false,
  };
}

describe("deriveSessionSummaryFromChats", () => {
  test("derives unread, streaming, and latest chat id from chat list", () => {
    const chats = [
      createChat("chat-3", { hasUnread: false, isStreaming: true }),
      createChat("chat-2", { hasUnread: true, isStreaming: false }),
      createChat("chat-1", { hasUnread: false, isStreaming: false }),
    ];

    expect(deriveSessionSummaryFromChats(chats)).toEqual({
      hasUnread: true,
      hasStreaming: true,
      latestChatId: "chat-3",
    });
  });

  test("handles empty chat list", () => {
    expect(deriveSessionSummaryFromChats([])).toEqual({
      hasUnread: false,
      hasStreaming: false,
      latestChatId: null,
    });
  });
});

describe("didSessionSummaryChange", () => {
  test("returns true on first summary sync", () => {
    expect(
      didSessionSummaryChange(null, {
        hasUnread: false,
        hasStreaming: false,
        latestChatId: "chat-1",
      }),
    ).toBe(true);
  });

  test("returns false when summary values are unchanged", () => {
    expect(
      didSessionSummaryChange(
        {
          hasUnread: true,
          hasStreaming: false,
          latestChatId: "chat-1",
        },
        {
          hasUnread: true,
          hasStreaming: false,
          latestChatId: "chat-1",
        },
      ),
    ).toBe(false);
  });

  test("returns true when any summary field changes", () => {
    expect(
      didSessionSummaryChange(
        {
          hasUnread: false,
          hasStreaming: true,
          latestChatId: "chat-1",
        },
        {
          hasUnread: true,
          hasStreaming: false,
          latestChatId: "chat-2",
        },
      ),
    ).toBe(true);
  });
});

describe("applySessionSummary", () => {
  test("updates only the targeted session summary fields", () => {
    const current = {
      sessions: [
        {
          id: "session-1",
          hasUnread: false,
          hasStreaming: false,
          latestChatId: "old-chat",
        },
        {
          id: "session-2",
          hasUnread: false,
          hasStreaming: false,
          latestChatId: "other-chat",
        },
      ],
    };

    const next = applySessionSummary(current, "session-1", {
      hasUnread: true,
      hasStreaming: true,
      latestChatId: "chat-new",
    });

    expect(next).toEqual({
      sessions: [
        {
          id: "session-1",
          hasUnread: true,
          hasStreaming: true,
          latestChatId: "chat-new",
        },
        {
          id: "session-2",
          hasUnread: false,
          hasStreaming: false,
          latestChatId: "other-chat",
        },
      ],
    });
  });

  test("returns same object reference when summary is unchanged", () => {
    const current = {
      sessions: [
        {
          id: "session-1",
          hasUnread: true,
          hasStreaming: false,
          latestChatId: "chat-1",
        },
      ],
    };

    const next = applySessionSummary(current, "session-1", {
      hasUnread: true,
      hasStreaming: false,
      latestChatId: "chat-1",
    });

    expect(next).toBe(current);
  });

  test("passes through undefined session data", () => {
    expect(
      applySessionSummary(undefined, "session-1", {
        hasUnread: true,
        hasStreaming: true,
        latestChatId: "chat-1",
      }),
    ).toBeUndefined();
  });
});

describe("applySessionSummaryFromChats", () => {
  test("derives summary from chats before applying updates", () => {
    const current = {
      sessions: [
        {
          id: "session-1",
          hasUnread: false,
          hasStreaming: false,
          latestChatId: null,
        },
      ],
    };

    const next = applySessionSummaryFromChats(current, "session-1", [
      createChat("chat-new", { hasUnread: true, isStreaming: true }),
    ]);

    expect(next).toEqual({
      sessions: [
        {
          id: "session-1",
          hasUnread: true,
          hasStreaming: true,
          latestChatId: "chat-new",
        },
      ],
    });
  });
});
