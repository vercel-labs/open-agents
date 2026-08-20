import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { signInternalHarnessRequest } from "@/lib/harness-runner/internal-request";

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

const { POST } = await import("./route");

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

describe("/api/internal/harness-runner", () => {
  test("rejects unsigned requests", async () => {
    const response = await POST(createRequest(false));

    expect(response.status).toBe(401);
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

    expect(response.status).toBe(401);
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

  test("marks responses uncacheable and unindexable", async () => {
    const rejected = await POST(createRequest(false));

    expect(rejected.headers.get("cache-control")).toBe("no-store");
    expect(rejected.headers.get("x-robots-tag")).toBe("noindex, nofollow");

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
