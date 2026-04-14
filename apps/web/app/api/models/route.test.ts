import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

interface MockGatewayModel extends Record<string, unknown> {
  id: string;
  modelType: "language" | "image";
  context_window?: number;
}

const gatewayModels: MockGatewayModel[] = [];
const requestedUrls: string[] = [];

let modelsDevApiData: unknown = {};
let gatewayGetAvailableModels = async () => ({ models: gatewayModels });

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
    getAvailableModels: () => gatewayGetAvailableModels(),
  },
}));

mock.module("server-only", () => ({}));

const routeModulePromise = import("./route");

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("/api/models context window enrichment", () => {
  beforeEach(() => {
    gatewayModels.length = 0;
    requestedUrls.length = 0;
    modelsDevApiData = {};
    gatewayGetAvailableModels = async () => ({ models: gatewayModels });

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

  test("keeps gateway context window when models.dev only has related ids", async () => {
    gatewayModels.push({
      id: "openai/gpt-5.3-codex-2026-02-15",
      modelType: "language",
      context_window: 200_000,
    });

    modelsDevApiData = {
      openai: {
        models: {
          "gpt-5": {
            limit: { context: 272_000 },
          },
          "gpt-5.3-codex": {
            limit: { context: 400_000 },
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

    expect(body.models).toHaveLength(1);
    expect(body.models[0]?.context_window).toBe(200_000);
  });

  test("falls back to valid language models when gateway returns an unknown modelType", async () => {
    const gatewayResponseError = new Error(
      "Invalid response from Gateway",
    ) as Error & {
      response?: unknown;
    };

    gatewayResponseError.response = {
      models: [
        {
          id: "openai/gpt-5.4-mini",
          name: "GPT-5.4 Mini",
          modelType: "language",
          specification: {
            specificationVersion: "v3",
            provider: "openai",
            modelId: "openai/gpt-5.4-mini",
          },
          pricing: {
            input: "0.00000025",
            output: "0.000002",
            input_cache_read: "0.000000025",
          },
        },
        {
          id: "openai/gpt-5.4-audio",
          name: "GPT-5.4 Audio",
          modelType: "audio",
          specification: {
            specificationVersion: "v3",
            provider: "openai",
            modelId: "openai/gpt-5.4-audio",
          },
        },
      ],
    };

    gatewayGetAvailableModels = async () => {
      throw gatewayResponseError;
    };

    const { GET } = await routeModulePromise;
    const response = await GET();

    expect(response.ok).toBe(true);

    const body = (await response.json()) as {
      models: Array<{
        id: string;
        modelType?: string;
        pricing?: {
          input: string;
          output: string;
          cachedInputTokens?: string;
        };
      }>;
    };

    expect(body.models).toHaveLength(1);
    expect(body.models[0]?.id).toBe("openai/gpt-5.4-mini");
    expect(body.models[0]?.modelType).toBe("language");
    expect(body.models[0]?.pricing?.cachedInputTokens).toBe("0.000000025");
  });
});
