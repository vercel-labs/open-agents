import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { INTERNAL_API_REJECTED_STATUS } from "@/lib/harness-runner/internal-endpoints";
import { signInternalHarnessRequest } from "@/lib/harness-runner/internal-request";
import { INTERNAL_API_MAX_BODY_BYTES } from "@/lib/harness-runner/internal-route";

// These tests call the route's exported handlers directly, which is the same
// thing as `proxy.ts` never having run. Every control asserted here therefore
// holds on its own; the proxy is only an optimization in front of it.

const originalSecret = process.env.INTERNAL_HARNESS_SECRET;
const RUNNER_URL = "https://preview.example.com/api/internal/harness-runner";
const sandboxProvider = {
  specificationVersion: "harness-sandbox-v1",
  providerId: "vercel-sandbox",
};

const spies = {
  connectSandbox: mock(async () => ({
    toHarnessSandboxProvider: () => sandboxProvider,
  })),
  runHarnessTurn: mock(
    async (input: {
      onChunk: (chunk: Record<string, unknown>) => Promise<void> | void;
    }) => {
      await input.onChunk({
        type: "text-delta",
        id: "text-1",
        delta: "hello",
      });
      return {
        responseMessage: {
          id: "assistant-1",
          role: "assistant" as const,
          parts: [{ type: "text", text: "hello" }],
        },
        finishReason: "stop" as const,
        rawFinishReason: "stop",
      };
    },
  ),
};

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: spies.connectSandbox,
}));

mock.module("@open-agents/harness-runner", () => ({
  ensureGatewayApiKeyEnv: async () => "test-gateway-key",
  isExternalHarnessId: (value: unknown) =>
    value === "codex" || value === "claude-code" || value === "pi",
  runHarnessTurn: spies.runHarnessTurn,
}));

beforeAll(() => {
  process.env.INTERNAL_HARNESS_SECRET = "test-internal-harness-secret";
});

afterAll(() => {
  if (originalSecret === undefined) {
    delete process.env.INTERNAL_HARNESS_SECRET;
  } else {
    process.env.INTERNAL_HARNESS_SECRET = originalSecret;
  }
});

const { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } =
  await import("./route");

const body = JSON.stringify({
  harnessId: "codex",
  sandboxState: { type: "vercel", sandboxName: "session-1" },
  workingDirectory: "/vercel/sandbox",
  sessionId: "codex-session-1",
  messageId: "assistant-1",
  messages: [
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "hello" }],
    },
  ],
  originalMessages: [],
  selectedModelId: "openai/gpt-5.4",
  modelId: "openai/gpt-5.4",
});

function createRequest(signed: boolean, requestBody = body) {
  return new Request(RUNNER_URL, {
    method: "POST",
    headers: signed
      ? {
          "x-open-agents-harness-signature": signInternalHarnessRequest({
            method: "POST",
            url: RUNNER_URL,
            body: requestBody,
          }),
        }
      : undefined,
    body: requestBody,
  });
}

function createRequestWithHarnessId(harnessId: string) {
  const parsedBody = JSON.parse(body) as Record<string, unknown>;
  return createRequest(true, JSON.stringify({ ...parsedBody, harnessId }));
}

beforeEach(() => {
  spies.connectSandbox.mockClear();
  spies.runHarnessTurn.mockClear();
});

describe("/api/internal/harness-runner", () => {
  test("rejects unsigned requests without reading their body", async () => {
    const request = createRequest(false);
    const response = await POST(request);

    // 404, not 401: the route is indistinguishable from a nonexistent one to
    // an unauthenticated caller even with no proxy in front of it.
    expect(response.status).toBe(INTERNAL_API_REJECTED_STATUS);
    expect(await response.text()).toBe("");
    expect(request.bodyUsed).toBe(false);
    expect(spies.connectSandbox).not.toHaveBeenCalled();
  });

  test("rejects a signature minted for another internal path", async () => {
    const response = await POST(
      new Request(RUNNER_URL, {
        method: "POST",
        headers: {
          "x-open-agents-harness-signature": signInternalHarnessRequest({
            method: "POST",
            url: "https://preview.example.com/api/internal/other-runner",
            body,
          }),
        },
        body,
      }),
    );

    expect(response.status).toBe(INTERNAL_API_REJECTED_STATUS);
    expect(spies.connectSandbox).not.toHaveBeenCalled();
  });

  test("rejects every verb other than POST", async () => {
    const handlers = { GET, HEAD, PUT, PATCH, DELETE, OPTIONS };

    for (const [method, handler] of Object.entries(handlers)) {
      const response = handler(new Request(RUNNER_URL, { method }));

      expect(response.status).toBe(INTERNAL_API_REJECTED_STATUS);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    }

    expect(spies.connectSandbox).not.toHaveBeenCalled();
  });

  test("rejects an over-cap body before starting a harness turn", async () => {
    const oversized = "x".repeat(INTERNAL_API_MAX_BODY_BYTES + 1);
    const response = await POST(createRequest(true, oversized));

    expect(response.status).toBe(INTERNAL_API_REJECTED_STATUS);
    expect(spies.connectSandbox).not.toHaveBeenCalled();
  });

  test("rejects a non-external harness id", async () => {
    const response = await POST(createRequestWithHarnessId("open-agent"));

    expect(response.status).toBe(400);
    const responseBody = (await response.json()) as { error: string };
    expect(responseBody.error).toStartWith("Invalid request:");
    expect(spies.connectSandbox).not.toHaveBeenCalled();
  });

  test("rejects a structurally invalid request body", async () => {
    const parsedBody = JSON.parse(body) as Record<string, unknown>;
    const response = await POST(
      createRequest(
        true,
        JSON.stringify({ ...parsedBody, messages: "not-an-array" }),
      ),
    );

    expect(response.status).toBe(400);
    const responseBody = (await response.json()) as { error: string };
    expect(responseBody.error).toStartWith("Invalid request:");
    expect(spies.connectSandbox).not.toHaveBeenCalled();
  });

  test("marks every response uncacheable and unindexable", async () => {
    const rejected = await POST(createRequest(false));

    expect(rejected.headers.get("cache-control")).toBe("no-store");
    expect(rejected.headers.get("x-robots-tag")).toBe("noindex, nofollow");

    const invalid = await POST(createRequestWithHarnessId("open-agent"));
    await invalid.text();

    expect(invalid.headers.get("cache-control")).toBe("no-store");
    expect(invalid.headers.get("x-robots-tag")).toBe("noindex, nofollow");

    const accepted = await POST(createRequest(true));
    await accepted.text();

    expect(accepted.headers.get("cache-control")).toBe("no-store");
    expect(accepted.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  test("accepts the claude-code harness", async () => {
    const response = await POST(createRequestWithHarnessId("claude-code"));

    expect(response.status).toBe(200);
    await response.text();
    expect(spies.runHarnessTurn).toHaveBeenCalledWith(
      expect.objectContaining({ harnessId: "claude-code" }),
    );
  });

  test("accepts the pi harness", async () => {
    const response = await POST(createRequestWithHarnessId("pi"));

    expect(response.status).toBe(200);
    await response.text();
    expect(spies.runHarnessTurn).toHaveBeenCalledWith(
      expect.objectContaining({ harnessId: "pi" }),
    );
  });

  test("streams runner chunks and the final result", async () => {
    const response = await POST(createRequest(true));
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(response.status).toBe(200);
    expect(spies.connectSandbox).toHaveBeenCalledWith(
      { type: "vercel", sandboxName: "session-1" },
      {
        ports: [3000, 5173, 4321, 8000, 5001, 5002, 5003, 5004, 5005],
      },
    );
    expect(spies.runHarnessTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        harnessId: "codex",
        sandboxProvider,
        workingDirectory: "/vercel/sandbox",
      }),
    );
    expect(events).toEqual([
      {
        type: "chunk",
        chunk: { type: "text-delta", id: "text-1", delta: "hello" },
      },
      {
        type: "result",
        result: {
          responseMessage: {
            id: "assistant-1",
            role: "assistant",
            parts: [{ type: "text", text: "hello" }],
          },
          finishReason: "stop",
          rawFinishReason: "stop",
        },
      },
    ]);
  });
});
