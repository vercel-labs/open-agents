import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ModelVariant } from "@/lib/model-variants";

type TestPreferences = {
  defaultModelId: string;
  defaultSubagentModelId: string | null;
  modelVariants: ModelVariant[];
  defaultSandboxType: "hybrid" | "vercel" | "just-bash";
};

let authenticatedUserId: string | null = "user-1";
let preferences: TestPreferences;

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () =>
    authenticatedUserId
      ? {
          user: {
            id: authenticatedUserId,
            username: "nico",
            name: "Nico",
            email: "nico@example.com",
          },
        }
      : null,
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => preferences,
  updateUserPreferences: async (
    _userId: string,
    updates: Partial<TestPreferences>,
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
    authenticatedUserId = "user-1";
    preferences = {
      defaultModelId: "anthropic/claude-haiku-4.5",
      defaultSubagentModelId: null,
      modelVariants: [
        {
          id: "variant:existing",
          name: "Existing",
          baseModelId: "openai/gpt-5.3-codex",
          providerOptions: { reasoningEffort: "high" },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      defaultSandboxType: "vercel",
    };
  });

  test("returns 401 when unauthenticated", async () => {
    authenticatedUserId = null;
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(401);
  });

  test("creates a model variant", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/settings/model-variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Codex 5.3 Thinking XHigh",
          baseModelId: "openai/gpt-5.3-codex",
          providerOptions: {
            reasoningEffort: "high",
            reasoningSummary: "detailed",
          },
        }),
      }),
    );

    expect(response.ok).toBe(true);

    const body = (await response.json()) as {
      modelVariant: ModelVariant;
      modelVariants: ModelVariant[];
    };

    expect(body.modelVariant.id.startsWith("variant:")).toBe(true);
    expect(body.modelVariants.length).toBe(2);
  });

  test("rejects non-object provider options", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/settings/model-variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Bad Variant",
          baseModelId: "openai/gpt-5.3-codex",
          providerOptions: ["not", "an", "object"],
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  test("updates an existing model variant", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request("http://localhost/api/settings/model-variants", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "variant:existing",
          name: "Existing Updated",
          providerOptions: { reasoningEffort: "medium" },
        }),
      }),
    );

    expect(response.ok).toBe(true);

    const body = (await response.json()) as {
      modelVariant: ModelVariant;
    };

    expect(body.modelVariant.name).toBe("Existing Updated");
    expect(body.modelVariant.providerOptions).toEqual({
      reasoningEffort: "medium",
    });
  });

  test("deletes an existing model variant", async () => {
    const { DELETE } = await routeModulePromise;

    const response = await DELETE(
      new Request("http://localhost/api/settings/model-variants", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "variant:existing" }),
      }),
    );

    expect(response.ok).toBe(true);

    const body = (await response.json()) as {
      modelVariants: ModelVariant[];
    };

    expect(body.modelVariants.length).toBe(0);
  });
});
