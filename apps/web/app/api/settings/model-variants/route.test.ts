import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ModelVariant } from "@/lib/model-variants";

mock.module("server-only", () => ({}));

let isAuthenticated = true;

interface MockPreferences {
  defaultModelId: string;
  defaultSubagentModelId: string | null;
  defaultSandboxType: "hybrid" | "vercel" | "just-bash";
  modelVariants: ModelVariant[];
}

let preferences: MockPreferences;

function resetPreferences() {
  preferences = {
    defaultModelId: "anthropic/claude-haiku-4.5",
    defaultSubagentModelId: null,
    defaultSandboxType: "vercel",
    modelVariants: [],
  };
}

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () =>
    isAuthenticated
      ? {
          user: {
            id: "user-1",
            username: "alice",
            email: "alice@example.com",
          },
        }
      : null,
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => preferences,
  updateUserPreferences: async (
    _userId: string,
    updates: Partial<MockPreferences>,
  ) => {
    preferences = {
      ...preferences,
      ...updates,
      modelVariants: updates.modelVariants ?? preferences.modelVariants,
    };
    return preferences;
  },
}));

const routeModulePromise = import("./route");

describe("/api/settings/model-variants", () => {
  beforeEach(() => {
    isAuthenticated = true;
    resetPreferences();
  });

  test("GET returns 401 when unauthenticated", async () => {
    isAuthenticated = false;

    const { GET } = await routeModulePromise;
    const response = await GET();

    expect(response.status).toBe(401);
  });

  test("POST creates a model variant and returns full list", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/settings/model-variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "OpenAI Medium",
          baseModelId: "openai/gpt-5",
          providerOptions: {
            reasoningEffort: "medium",
          },
        }),
      }),
    );

    expect(response.ok).toBe(true);

    const body = (await response.json()) as { modelVariants: ModelVariant[] };
    expect(body.modelVariants).toHaveLength(1);
    expect(body.modelVariants[0]?.id.startsWith("variant:")).toBe(true);
    expect(body.modelVariants[0]?.name).toBe("OpenAI Medium");
  });

  test("PATCH updates a model variant and returns full list", async () => {
    preferences.modelVariants = [
      {
        id: "variant:openai-medium",
        name: "OpenAI Medium",
        baseModelId: "openai/gpt-5",
        providerOptions: { reasoningEffort: "medium" },
      },
    ];

    const { PATCH } = await routeModulePromise;
    const response = await PATCH(
      new Request("http://localhost/api/settings/model-variants", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "variant:openai-medium",
          providerOptions: { reasoningEffort: "high" },
        }),
      }),
    );

    expect(response.ok).toBe(true);

    const body = (await response.json()) as { modelVariants: ModelVariant[] };
    expect(body.modelVariants[0]?.providerOptions).toEqual({
      reasoningEffort: "high",
    });
  });

  test("DELETE removes a model variant and returns full list", async () => {
    preferences.modelVariants = [
      {
        id: "variant:remove-me",
        name: "To remove",
        baseModelId: "anthropic/claude-haiku-4.5",
        providerOptions: {},
      },
    ];

    const { DELETE } = await routeModulePromise;
    const response = await DELETE(
      new Request("http://localhost/api/settings/model-variants", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "variant:remove-me" }),
      }),
    );

    expect(response.ok).toBe(true);

    const body = (await response.json()) as { modelVariants: ModelVariant[] };
    expect(body.modelVariants).toHaveLength(0);
  });

  test("POST rejects provider options larger than 16KB", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/settings/model-variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Too big",
          baseModelId: "openai/gpt-5",
          providerOptions: {
            payload: "x".repeat(17_000),
          },
        }),
      }),
    );

    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("16 KB");
  });
});
