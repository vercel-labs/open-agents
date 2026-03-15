import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

type ChatRecord = { id: string };
type MessageRecord = {
  role: "user" | "assistant";
  parts: unknown[];
};

let chats: ChatRecord[] = [];
let messagesByChatId: Record<string, MessageRecord[]> = {};

mock.module("@/lib/db/sessions", () => ({
  getChatsBySessionId: async () => chats,
  getChatMessages: async (chatId: string) => messagesByChatId[chatId] ?? [],
}));

const helpersModulePromise = import("./generate-pr-helpers");
const originalFetch = globalThis.fetch;

function createMockResponse(init: {
  ok: boolean;
  status?: number;
  jsonData?: unknown;
  textData?: string;
}): Response {
  return {
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 500),
    json: async () => init.jsonData,
    text: async () => init.textData ?? "",
  } as unknown as Response;
}

describe("generate-pr helpers", () => {
  beforeEach(() => {
    chats = [];
    messagesByChatId = {};
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("generateBranchName uses initials and 8-char random suffix", async () => {
    const { generateBranchName } = await helpersModulePromise;

    const fromName = generateBranchName("octocat", "Alice Bob");
    const fromUsername = generateBranchName("xyUser", null);

    expect(fromName).toMatch(/^ab\/[a-f0-9]{8}$/);
    expect(fromUsername).toMatch(/^xy\/[a-f0-9]{8}$/);
  });

  test("looksLikeCommitHash detects commit-looking strings", async () => {
    const { looksLikeCommitHash } = await helpersModulePromise;

    expect(looksLikeCommitHash("abc1234")).toBe(true);
    expect(looksLikeCommitHash("ABCDEF1234567")).toBe(true);
    expect(looksLikeCommitHash("feature/branch")).toBe(false);
  });

  test("error classifier helpers detect permission and retryable push errors", async () => {
    const { isPermissionPushError, isRetryableForkPushError } =
      await helpersModulePromise;

    expect(isPermissionPushError("Permission denied to repository")).toBe(true);
    expect(
      isRetryableForkPushError(
        "remote: Repository not found while propagating",
      ),
    ).toBe(true);
    expect(isPermissionPushError("all good")).toBe(false);
    expect(isRetryableForkPushError("all good")).toBe(false);
  });

  test("redactGitHubToken removes token from authenticated URLs", async () => {
    const { redactGitHubToken } = await helpersModulePromise;

    const redacted = redactGitHubToken(
      "fatal: could not access https://x-access-token:secret@github.com/org/repo.git",
    );

    expect(redacted).toContain("https://x-access-token:***@github.com");
    expect(redacted).not.toContain("secret@github.com");
  });

  test("extractGitHubOwnerFromRemoteUrl handles https and ssh remotes", async () => {
    const { extractGitHubOwnerFromRemoteUrl } = await helpersModulePromise;

    expect(
      extractGitHubOwnerFromRemoteUrl("https://github.com/acme/widgets.git"),
    ).toBe("acme");
    expect(
      extractGitHubOwnerFromRemoteUrl("git@github.com:octo/repo.git"),
    ).toBe("octo");
    expect(extractGitHubOwnerFromRemoteUrl("")).toBeNull();
  });

  test("ensureForkExists returns success when public fork lookup succeeds", async () => {
    const { ensureForkExists } = await helpersModulePromise;

    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      return Promise.resolve(
        createMockResponse({
          ok: true,
          jsonData: { name: "widgets-fork" },
        }),
      );
    }) as unknown as typeof fetch;

    const result = await ensureForkExists({
      token: "token-1",
      upstreamOwner: "acme",
      upstreamRepo: "widgets",
      forkOwner: "alice",
    });

    expect(result).toEqual({ success: true, forkRepoName: "widgets-fork" });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe(
      "https://api.github.com/repos/alice/widgets",
    );
  });

  test("ensureForkExists returns actionable error when fork creation is denied", async () => {
    const { ensureForkExists } = await helpersModulePromise;

    const responses = [
      createMockResponse({ ok: false, status: 404 }),
      createMockResponse({ ok: false, status: 404 }),
      createMockResponse({
        ok: false,
        status: 403,
        textData: "Resource not accessible by integration",
      }),
    ];

    globalThis.fetch = mock(() => {
      const next = responses.shift();
      if (!next) {
        throw new Error("Unexpected extra fetch call");
      }
      return Promise.resolve(next);
    }) as unknown as typeof fetch;

    const result = await ensureForkExists({
      token: "token-1",
      upstreamOwner: "acme",
      upstreamRepo: "widgets",
      forkOwner: "alice",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain(
        "GitHub denied automatic fork creation for this token",
      );
    }
  });

  test("getConversationContext returns only text parts with role labels", async () => {
    const { getConversationContext } = await helpersModulePromise;

    chats = [{ id: "chat-1" }];
    messagesByChatId["chat-1"] = [
      {
        role: "user",
        parts: [
          { type: "text", text: "  first question  " },
          { type: "tool-call", toolName: "search" },
        ],
      },
      {
        role: "assistant",
        parts: [
          { type: "text", text: "  first answer  " },
          { type: "tool-result", result: { ok: true } },
        ],
      },
    ];

    const context = await getConversationContext("session-1");

    expect(context).toBe("User: first question\nAssistant: first answer");
  });

  test("forkPushRetryConfig exposes expected retry defaults", async () => {
    const { forkPushRetryConfig } = await helpersModulePromise;

    expect(forkPushRetryConfig).toEqual({ attempts: 12, delayMs: 2000 });
  });
});
