import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { runHarnessTurnViaApi } from "./client";
import { verifyInternalHarnessRequest } from "./internal-request";

const originalFetch = globalThis.fetch;
const originalEnv = {
  INTERNAL_HARNESS_SECRET: process.env.INTERNAL_HARNESS_SECRET,
  VERCEL_AUTOMATION_BYPASS_SECRET: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
  VERCEL_OIDC_TOKEN: process.env.VERCEL_OIDC_TOKEN,
};

beforeEach(() => {
  process.env.INTERNAL_HARNESS_SECRET = "test-internal-harness-secret";
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "test-bypass-secret";
  process.env.VERCEL_OIDC_TOKEN = "test-oidc-token";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe("runHarnessTurnViaApi", () => {
  test("forwards streamed chunks and returns the final result", async () => {
    const fetchMock = mock(
      async (url: string | URL | Request, init?: RequestInit) => {
        const body = String(init?.body);
        const headers = new Headers(init?.headers);
        expect(String(url)).toBe(
          "https://preview.example.com/api/internal/harness-runner",
        );
        expect(
          verifyInternalHarnessRequest({
            method: "POST",
            url: String(url),
            body,
            signature: headers.get("x-open-agents-harness-signature"),
          }),
        ).toBe(true);
        expect(headers.get("x-vercel-protection-bypass")).toBe(
          "test-bypass-secret",
        );
        expect(headers.get("x-vercel-trusted-oidc-idp-token")).toBe(
          "test-oidc-token",
        );
        expect(headers.get("x-vercel-oidc-token")).toBeNull();

        return new Response(
          [
            JSON.stringify({
              type: "chunk",
              chunk: { type: "text-delta", id: "text-1", delta: "hello" },
            }),
            JSON.stringify({
              type: "result",
              result: {
                responseMessage: {
                  id: "assistant-1",
                  role: "assistant",
                  parts: [{ type: "text", text: "hello" }],
                },
                finishReason: "stop",
                rawFinishReason: "stop",
                usage: { totalTokens: 3 },
              },
            }),
            "",
          ].join("\n"),
          { status: 200 },
        );
      },
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const chunks: unknown[] = [];

    const result = await runHarnessTurnViaApi({
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
      requestUrl: "https://preview.example.com/api/chat",
      onChunk: (chunk) => {
        chunks.push(chunk);
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(chunks).toEqual([
      { type: "text-delta", id: "text-1", delta: "hello" },
    ]);
    expect(result.finishReason).toBe("stop");
    expect(result.responseMessage.parts).toEqual([
      { type: "text", text: "hello" },
    ]);
  });

  test("surfaces a streamed runner error", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          `${JSON.stringify({ type: "error", error: "bridge failed" })}\n`,
          { status: 200 },
        ),
    ) as unknown as typeof fetch;

    await expect(
      runHarnessTurnViaApi({
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
        requestUrl: "https://preview.example.com/api/chat",
        onChunk: () => {},
      }),
    ).rejects.toThrow("bridge failed");
  });
});
