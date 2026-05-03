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
let viewerSession: { user: { id: string } } | null = null;
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

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => viewerSession,
}));

mock.module("@/lib/managed-template-page-access", () => ({
  redirectManagedTemplateUser: async () => {},
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
    viewerSession = null;
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

  test("passes ownerSessionHref when viewer owns the session", async () => {
    viewerSession = { user: { id: "user-1" } };
    const { default: SharedPage } = await pageModulePromise;

    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        ownerSessionHref: string | null;
      };
    };

    expect(element.props.ownerSessionHref).toBe(
      "/sessions/session-1/chats/chat-1",
    );
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

  test("redacts top-level .env tool content on shared pages", async () => {
    messageRows = [
      {
        parts: {
          id: "m1",
          role: "assistant",
          parts: [
            {
              type: "tool-read",
              state: "output-available",
              input: { filePath: ".env.local" },
              output: {
                success: true,
                content: "1: SECRET=shh\n2: TOKEN=abc",
                totalLines: 2,
                startLine: 1,
                endLine: 2,
              },
            },
            {
              type: "tool-write",
              state: "output-available",
              input: {
                filePath: "apps/web/.env.example",
                content: "FOO=bar\nBAR=baz",
              },
              output: { success: true },
            },
            {
              type: "tool-edit",
              state: "output-available",
              input: {
                filePath: ".env",
                oldString: "OLD_SECRET=one",
                newString: "NEW_SECRET=two",
              },
              output: { success: true },
            },
            {
              type: "tool-write",
              state: "output-available",
              input: {
                filePath: "README.md",
                content: "visible content",
              },
              output: { success: true },
            },
          ],
        },
        role: "assistant",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ];

    const { default: SharedPage } = await pageModulePromise;
    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        chats: Array<{
          messagesWithTiming: Array<{
            message: { parts: Array<Record<string, unknown>> };
          }>;
        }>;
      };
    };

    const parts = element.props.chats[0]?.messagesWithTiming[0]?.message.parts;

    expect(parts?.[0]?.output).toEqual({
      success: true,
      content: "1: [redacted from shared page]\n2: [redacted from shared page]",
      totalLines: 2,
      startLine: 1,
      endLine: 2,
    });
    expect(parts?.[1]?.input).toEqual({
      filePath: "apps/web/.env.example",
      content:
        "[content redacted from shared page]\n[content redacted from shared page]",
    });
    expect(parts?.[2]?.input).toEqual({
      filePath: ".env",
      oldString: "[previous content redacted from shared page]",
      newString: "[updated content redacted from shared page]",
    });
    expect(parts?.[3]?.input).toEqual({
      filePath: "README.md",
      content: "visible content",
    });
  });

  test("redacts nested .env tool content inside shared task output", async () => {
    messageRows = [
      {
        parts: {
          id: "m1",
          role: "assistant",
          parts: [
            {
              type: "tool-task",
              state: "output-available",
              preliminary: false,
              input: {
                task: "Inspect secrets",
                subagentType: "executor",
              },
              output: {
                final: [
                  {
                    role: "assistant",
                    content: [
                      {
                        type: "tool-call",
                        toolCallId: "call-read",
                        toolName: "read",
                        input: { filePath: ".env" },
                      },
                      {
                        type: "tool-call",
                        toolCallId: "call-edit",
                        toolName: "edit",
                        input: {
                          filePath: ".env.local",
                          oldString: "SECRET=old",
                          newString: "SECRET=new",
                        },
                      },
                    ],
                  },
                  {
                    role: "tool",
                    content: [
                      {
                        type: "tool-result",
                        toolCallId: "call-read",
                        output: {
                          type: "json",
                          value: {
                            success: true,
                            content: "1: SECRET=old",
                            totalLines: 1,
                            startLine: 1,
                            endLine: 1,
                          },
                        },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
        role: "assistant",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ];

    const { default: SharedPage } = await pageModulePromise;
    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        chats: Array<{
          messagesWithTiming: Array<{
            message: { parts: Array<Record<string, unknown>> };
          }>;
        }>;
      };
    };

    const taskPart = element.props.chats[0]?.messagesWithTiming[0]?.message
      .parts[0] as Record<string, unknown>;
    const taskOutput = taskPart.output as {
      final: Array<Record<string, unknown>>;
    };
    const nestedAssistant = taskOutput.final[0]?.content as Array<
      Record<string, unknown>
    >;
    const nestedTool = taskOutput.final[1]?.content as Array<
      Record<string, unknown>
    >;

    expect(nestedAssistant[1]?.input).toEqual({
      filePath: ".env.local",
      oldString: "[previous content redacted from shared page]",
      newString: "[updated content redacted from shared page]",
    });
    expect(nestedTool[0]?.output).toEqual({
      type: "json",
      value: {
        success: true,
        content: "1: [redacted from shared page]",
        totalLines: 1,
        startLine: 1,
        endLine: 1,
      },
    });
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
