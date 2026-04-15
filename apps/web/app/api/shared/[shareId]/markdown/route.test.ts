import { beforeEach, describe, expect, mock, test } from "bun:test";

let shareRecord: { id: string; chatId: string } | null = {
  id: "share-1",
  chatId: "chat-1",
};

let chatRecord: {
  id: string;
  sessionId: string;
} | null = {
  id: "chat-1",
  sessionId: "session-1",
};

let sessionRecord: {
  id: string;
  title: string;
  repoOwner: string | null;
  repoName: string | null;
  branch: string | null;
  prNumber: number | null;
  createdAt: Date;
} | null = {
  id: "session-1",
  title: "Debug flaky tests",
  repoOwner: "acme",
  repoName: "repo",
  branch: "fix/flaky-ci",
  prNumber: 123,
  createdAt: new Date("2025-01-01T12:00:00Z"),
};

let messageRows: Array<{ parts: unknown; role: string; createdAt: Date }> = [
  {
    parts: {
      id: "m1",
      role: "user",
      parts: [
        { type: "text", text: "Please debug the flaky tests." },
        {
          type: "data-snippet",
          id: "snippet-1",
          data: {
            filename: "logs/test-output.txt",
            content:
              " FAIL  tests/flaky.test.ts\nExpected 200 but received 500",
          },
        },
      ],
    },
    role: "user",
    createdAt: new Date("2025-01-01T12:00:00Z"),
  },
  {
    parts: {
      id: "m2",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "Investigating the failure." },
        {
          type: "tool-read",
          state: "output-available",
          input: { filePath: "README.md" },
          output: {
            success: true,
            content: "1: hello",
            totalLines: 1,
            startLine: 1,
            endLine: 1,
          },
        },
        {
          type: "tool-edit",
          state: "output-available",
          input: {
            filePath: "src/test.ts",
            oldString: "before",
            newString: "after",
            startLine: 1,
          },
          output: { success: true },
        },
        { type: "text", text: "I fixed the timeout handling." },
      ],
    },
    role: "assistant",
    createdAt: new Date("2025-01-01T12:15:00Z"),
  },
];

mock.module("@/lib/db/sessions-cache", () => ({
  getShareByIdCached: async () => shareRecord,
  getSessionByIdCached: async () => sessionRecord,
}));

mock.module("@/lib/db/sessions", () => ({
  getChatById: async () => chatRecord,
  getChatMessages: async () => messageRows,
}));

const routeModulePromise = import("./route");

function makeRequest(accept = "text/markdown") {
  return new Request("http://localhost/api/shared/share-1/markdown", {
    headers: { Accept: accept },
  });
}

function makeContext(shareId = "share-1") {
  return { params: Promise.resolve({ shareId }) };
}

describe("GET /api/shared/:shareId/markdown", () => {
  beforeEach(() => {
    shareRecord = { id: "share-1", chatId: "chat-1" };
    chatRecord = { id: "chat-1", sessionId: "session-1" };
    sessionRecord = {
      id: "session-1",
      title: "Debug flaky tests",
      repoOwner: "acme",
      repoName: "repo",
      branch: "fix/flaky-ci",
      prNumber: 123,
      createdAt: new Date("2025-01-01T12:00:00Z"),
    };
    messageRows = [
      {
        parts: {
          id: "m1",
          role: "user",
          parts: [
            { type: "text", text: "Please debug the flaky tests." },
            {
              type: "data-snippet",
              id: "snippet-1",
              data: {
                filename: "logs/test-output.txt",
                content:
                  " FAIL  tests/flaky.test.ts\nExpected 200 but received 500",
              },
            },
          ],
        },
        role: "user",
        createdAt: new Date("2025-01-01T12:00:00Z"),
      },
      {
        parts: {
          id: "m2",
          role: "assistant",
          parts: [
            { type: "reasoning", text: "Investigating the failure." },
            {
              type: "tool-read",
              state: "output-available",
              input: { filePath: "README.md" },
              output: {
                success: true,
                content: "1: hello",
                totalLines: 1,
                startLine: 1,
                endLine: 1,
              },
            },
            {
              type: "tool-edit",
              state: "output-available",
              input: {
                filePath: "src/test.ts",
                oldString: "before",
                newString: "after",
                startLine: 1,
              },
              output: { success: true },
            },
            { type: "text", text: "I fixed the timeout handling." },
          ],
        },
        role: "assistant",
        createdAt: new Date("2025-01-01T12:15:00Z"),
      },
    ];
  });

  test("returns 404 when share does not exist", async () => {
    shareRecord = null;
    const { GET } = await routeModulePromise;

    const response = await GET(makeRequest(), makeContext("missing"));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found\n");
  });

  test("returns markdown with frontmatter and per-turn tool activity", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(makeRequest(), makeContext());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("vary")).toBe("Accept");
    expect(body).toContain('session_name: "Debug flaky tests"');
    expect(body).toContain('repo: "acme/repo"');
    expect(body).toContain('branch: "fix/flaky-ci"');
    expect(body).toContain('pr_url: "https://github.com/acme/repo/pull/123"');
    expect(body).toContain("pr_number: 123");
    expect(body).toContain('created_at: "2025-01-01T12:00:00.000Z"');
    expect(body).toContain("## User\nPlease debug the flaky tests.");
    expect(body).toContain(
      '<snippet filename="logs/test-output.txt">\n FAIL  tests/flaky.test.ts\nExpected 200 but received 500\n</snippet>',
    );
    expect(body).toContain("<!-- tool_activity: duration=15m tool_calls=2 -->");
    expect(body).toContain("## Assistant\nI fixed the timeout handling.");
    expect(body).not.toContain("README.md");
  });

  test("returns the same payload for text/plain requests", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(makeRequest("text/plain"), makeContext());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(body).toContain("<!-- tool_activity: duration=15m tool_calls=2 -->");
  });
});
