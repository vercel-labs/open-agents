import { beforeEach, describe, expect, mock, test } from "bun:test";

const NOT_FOUND_ERROR = new Error("not-found");

const MockDiffsProvider = ({ children }: { children: unknown }) => children;
const MockSessionChatProvider = ({ children }: { children: unknown }) =>
  children;
const MockSessionChatContent = (_props: unknown) => null;

type SessionRecord = {
  id: string;
  userId: string;
  title: string;
};

type ChatRecord = {
  id: string;
  sessionId: string;
  modelId: string | null;
};

type ChatSummary = {
  id: string;
};

let currentUser: { id: string } | null = { id: "user-1" };
let sessionRecord: SessionRecord | null = {
  id: "session-1",
  userId: "user-1",
  title: "Session title",
};
let chatRecord: ChatRecord | null = {
  id: "chat-1",
  sessionId: "session-1",
  modelId: "model-1",
};
let messageRows: Array<{ parts: unknown }> = [
  {
    parts: { id: "message-1", role: "user", parts: [] },
  },
];
let sessionChatSummaries: ChatSummary[] = [{ id: "chat-1" }];
let chatSummariesArgs: { sessionId: string; userId: string } | null = null;

mock.module("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND_ERROR;
  },
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

mock.module("@/components/diffs-provider", () => ({
  DiffsProvider: MockDiffsProvider,
}));

mock.module("./session-chat-context", () => ({
  SessionChatProvider: MockSessionChatProvider,
}));

mock.module("./session-chat-content", () => ({
  SessionChatContent: MockSessionChatContent,
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () =>
    currentUser ? { user: currentUser } : { user: null },
}));

mock.module("@/lib/db/sessions-cache", () => ({
  getSessionByIdCached: async () => sessionRecord,
}));

mock.module("@/lib/db/sessions", () => ({
  getChatById: async () => chatRecord,
  getChatMessages: async () => messageRows,
  getChatSummariesBySessionId: async (sessionId: string, userId: string) => {
    chatSummariesArgs = { sessionId, userId };
    return sessionChatSummaries;
  },
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => ({
    defaultModelId: "model-1",
    modelVariants: [],
  }),
}));

mock.module("@/lib/model-options", () => ({
  buildSessionChatModelOptions: () => [
    {
      id: "model-1",
      contextWindow: 200_000,
    },
  ],
  withMissingModelOption: <T>(options: T) => options,
}));

mock.module("@/lib/models-with-context", () => ({
  fetchAvailableLanguageModelsWithContext: async () => [],
}));

const pageModulePromise = import("./page");

function getContentElement(pageElement: unknown): {
  type: unknown;
  props: {
    initialIsOnlyChatInSession: boolean;
  };
} {
  const diffsProviderElement = pageElement as {
    props: {
      children: {
        props: {
          children: {
            type: unknown;
            props: {
              initialIsOnlyChatInSession: boolean;
            };
          };
        };
      };
    };
  };

  return diffsProviderElement.props.children.props.children;
}

describe("/sessions/[sessionId]/chats/[chatId] page", () => {
  beforeEach(() => {
    currentUser = { id: "user-1" };
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      title: "Session title",
    };
    chatRecord = {
      id: "chat-1",
      sessionId: "session-1",
      modelId: "model-1",
    };
    messageRows = [
      {
        parts: { id: "message-1", role: "user", parts: [] },
      },
    ];
    sessionChatSummaries = [{ id: "chat-1" }];
    chatSummariesArgs = null;
  });

  test("passes a server-derived only-chat flag so the chat view stays decoupled from live layout chat state", async () => {
    const { default: SessionChatPage } = await pageModulePromise;

    const pageElement = await SessionChatPage({
      params: Promise.resolve({ sessionId: "session-1", chatId: "chat-1" }),
    });

    const contentElement = getContentElement(pageElement);

    expect(chatSummariesArgs).toEqual({
      sessionId: "session-1",
      userId: "user-1",
    });
    expect(contentElement.type).toBe(MockSessionChatContent);
    expect(contentElement.props.initialIsOnlyChatInSession).toBe(true);
  });

  test("passes false when the session already has multiple chats", async () => {
    sessionChatSummaries = [{ id: "chat-1" }, { id: "chat-2" }];
    const { default: SessionChatPage } = await pageModulePromise;

    const pageElement = await SessionChatPage({
      params: Promise.resolve({ sessionId: "session-1", chatId: "chat-1" }),
    });

    const contentElement = getContentElement(pageElement);

    expect(contentElement.props.initialIsOnlyChatInSession).toBe(false);
  });

  test("passes false when chat summaries are stale and do not include the current chat", async () => {
    chatRecord = {
      id: "chat-2",
      sessionId: "session-1",
      modelId: "model-1",
    };
    sessionChatSummaries = [{ id: "chat-1" }];
    const { default: SessionChatPage } = await pageModulePromise;

    const pageElement = await SessionChatPage({
      params: Promise.resolve({ sessionId: "session-1", chatId: "chat-2" }),
    });

    const contentElement = getContentElement(pageElement);

    expect(contentElement.props.initialIsOnlyChatInSession).toBe(false);
  });
});
