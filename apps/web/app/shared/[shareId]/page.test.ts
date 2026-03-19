import { beforeEach, describe, expect, mock, test } from "bun:test";

const NOT_FOUND_ERROR = new Error("not-found");

let shareRecord: { id: string; chatId: string } | null = {
  id: "share-1",
  chatId: "chat-1",
};
let chatRecord: {
  id: string;
  sessionId: string;
  title: string;
  modelId: string | null;
  activeStreamId: string | null;
} | null = {
  id: "chat-1",
  sessionId: "session-1",
  title: "Debug flaky tests",
  modelId: "anthropic/claude-opus-4.6",
  activeStreamId: null,
};
let sessionRecord: {
  id: string;
  userId: string;
  title: string;
  repoOwner: string | null;
  repoName: string | null;
  branch: string | null;
  cloneUrl: string | null;
  prNumber: number | null;
  prStatus: string | null;
} | null = {
  id: "session-1",
  userId: "user-1",
  title: "Session Title",
  repoOwner: "acme",
  repoName: "repo",
  branch: "main",
  cloneUrl: "https://github.com/acme/repo.git",
  prNumber: null,
  prStatus: null,
};
let messageRows: Array<{ parts: unknown; role: string; createdAt: Date }> = [
  {
    parts: { id: "m1", role: "user", parts: [] },
    role: "user",
    createdAt: new Date("2025-01-01T00:00:00Z"),
  },
];
let userModelVariants: Array<{
  id: string;
  name: string;
  baseModelId: string;
  providerOptions: Record<string, unknown>;
}> = [];

mock.module("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND_ERROR;
  },
}));

mock.module("@/lib/db/sessions-cache", () => ({
  getShareByIdCached: async () => shareRecord,
  getSessionByIdCached: async () => sessionRecord,
}));

mock.module("@/lib/db/client", () => ({
  db: {
    query: {
      users: {
        findFirst: async () => ({
          username: "testuser",
          name: "Test User",
          avatarUrl: "https://example.com/avatar.png",
        }),
      },
    },
  },
}));

mock.module("@/lib/db/sessions", () => ({
  getChatById: async () => chatRecord,
  getChatMessages: async () => messageRows,
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => ({
    defaultModelId: "anthropic/claude-opus-4.6",
    defaultSubagentModelId: null,
    defaultSandboxType: "vercel",
    defaultDiffMode: "unified",
    autoCommitPush: false,
    modelVariants: userModelVariants,
  }),
}));

mock.module("./shared-chat-content", () => ({
  SharedChatContent: (_props: unknown) => null,
}));

const pageModulePromise = import("./page");

describe("/shared/[shareId] page", () => {
  beforeEach(() => {
    shareRecord = { id: "share-1", chatId: "chat-1" };
    chatRecord = {
      id: "chat-1",
      sessionId: "session-1",
      title: "Debug flaky tests",
      modelId: "anthropic/claude-opus-4.6",
      activeStreamId: null,
    };
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      title: "Session Title",
      repoOwner: "acme",
      repoName: "repo",
      branch: "main",
      cloneUrl: "https://github.com/acme/repo.git",
      prNumber: null,
      prStatus: null,
    };
    messageRows = [
      {
        parts: { id: "m1", role: "user", parts: [] },
        role: "user",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ];
    userModelVariants = [];
  });

  test("generateMetadata uses shared chat title", async () => {
    const { generateMetadata } = await pageModulePromise;

    const metadata = await generateMetadata({
      params: Promise.resolve({ shareId: "share-1" }),
    });

    expect(metadata.title).toBe("Debug flaky tests");
  });

  test("renders exactly one shared chat from share id mapping", async () => {
    const { default: SharedPage } = await pageModulePromise;

    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        chats: Array<{ chat: { id: string }; messagesWithTiming: unknown[] }>;
      };
    };

    expect(element.props.chats).toHaveLength(1);
    expect(element.props.chats[0]?.chat.id).toBe("chat-1");
    expect(element.props.chats[0]?.messagesWithTiming).toHaveLength(1);
  });

  test("passes custom variant name to shared chat content", async () => {
    chatRecord = {
      id: "chat-1",
      sessionId: "session-1",
      title: "Debug flaky tests",
      modelId: "variant:abc123",
      activeStreamId: null,
    };
    userModelVariants = [
      {
        id: "variant:abc123",
        name: "Gateway Usage Variant",
        baseModelId: "openai/gpt-5.4",
        providerOptions: {
          reasoningEffort: "high",
        },
      },
    ];

    const { default: SharedPage } = await pageModulePromise;

    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        modelName: string | null;
      };
    };

    expect(element.props.modelName).toBe("Gateway Usage Variant");
  });

  test("throws notFound when share mapping does not exist", async () => {
    shareRecord = null;
    const { default: SharedPage } = await pageModulePromise;

    expect(async () => {
      await SharedPage({ params: Promise.resolve({ shareId: "missing" }) });
    }).toThrow("not-found");
  });

  test("passes isStreaming=false and lastUserMessageSentAt when chat is idle", async () => {
    const { default: SharedPage } = await pageModulePromise;

    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        isStreaming: boolean;
        lastUserMessageSentAt: string | null;
        shareId: string;
      };
    };

    expect(element.props.isStreaming).toBe(false);
    expect(element.props.lastUserMessageSentAt).toBe(
      "2025-01-01T00:00:00.000Z",
    );
    expect(element.props.shareId).toBe("share-1");
  });

  test("passes isStreaming=true when chat has an active stream", async () => {
    chatRecord = {
      id: "chat-1",
      sessionId: "session-1",
      title: "Debug flaky tests",
      modelId: "anthropic/claude-opus-4.6",
      activeStreamId: "stream-abc",
    };
    const { default: SharedPage } = await pageModulePromise;

    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: { isStreaming: boolean; lastUserMessageSentAt: string | null };
    };

    expect(element.props.isStreaming).toBe(true);
    expect(element.props.lastUserMessageSentAt).toBe(
      "2025-01-01T00:00:00.000Z",
    );
  });

  test("lastUserMessageSentAt is null when there are no user messages", async () => {
    messageRows = [
      {
        parts: { id: "m1", role: "assistant", parts: [] },
        role: "assistant",
        createdAt: new Date("2025-01-01T00:01:00Z"),
      },
    ];
    const { default: SharedPage } = await pageModulePromise;

    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: { lastUserMessageSentAt: string | null };
    };

    expect(element.props.lastUserMessageSentAt).toBeNull();
  });
});
