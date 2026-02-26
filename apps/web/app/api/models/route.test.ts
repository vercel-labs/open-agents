import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

interface MockGatewayModel extends Record<string, unknown> {
  id: string;
  modelType: "language" | "image";
  context_window?: number;
}

const gatewayModels: MockGatewayModel[] = [];
const requestedUrls: string[] = [];

let modelsDevApiData: unknown = {};

const originalFetch = globalThis.fetch;

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

mock.module("ai", () => ({
  gateway: {
    getAvailableModels: async () => ({ models: gatewayModels }),
  },
}));

const routeModulePromise = import("./route");

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("/api/models context window enrichment", () => {
  beforeEach(() => {
    gatewayModels.length = 0;
    requestedUrls.length = 0;
    modelsDevApiData = {};

    globalThis.fetch = mock((input: RequestInfo | URL, _init?: RequestInit) => {
      requestedUrls.push(getRequestUrl(input));
      return Promise.resolve(
        new Response(JSON.stringify(modelsDevApiData), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;
  });

  test("overrides gateway context windows from models.dev", async () => {
    gatewayModels.push(
      {
        id: "openai/gpt-5.3-codex",
        modelType: "language",
        context_window: 200_000,
      },
      {
        id: "anthropic/claude-opus-4.6",
        modelType: "language",
        context_window: 200_000,
      },
      {
        id: "openai/gpt-4o-mini",
        modelType: "language",
        context_window: 128_000,
      },
      {
        id: "openai/image-gen",
        modelType: "image",
        context_window: 200_000,
      },
    );

    modelsDevApiData = {
      openai: {
        models: {
          "gpt-5.3-codex": {
            limit: { context: 400_000 },
          },
        },
      },
      anthropic: {
        models: {
          "claude-opus-4.6": {
            limit: { context: 1_000_000 },
          },
        },
      },
    };

    const { GET } = await routeModulePromise;
    const response = await GET();

    expect(response.ok).toBe(true);

    const body = (await response.json()) as {
      models: Array<{ id: string; context_window?: number }>;
    };
    const contextById = new Map(
      body.models.map((model) => [model.id, model.context_window]),
    );

    expect(contextById.get("openai/gpt-5.3-codex")).toBe(400_000);
    expect(contextById.get("anthropic/claude-opus-4.6")).toBe(1_000_000);
    expect(contextById.get("openai/gpt-4o-mini")).toBe(128_000);
    expect(contextById.has("openai/image-gen")).toBe(false);
    expect(requestedUrls).toContain("https://models.dev/api.json");
  });
});
