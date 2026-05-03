import { beforeEach, describe, expect, mock, test } from "bun:test";

let currentSession: {
  authProvider?: "vercel" | "github";
  user: { id: string; email?: string };
} | null = {
  user: { id: "user-1" },
};

const preferencesState = {
  defaultModelId: "anthropic/claude-haiku-4.5",
  defaultSubagentModelId: null as string | null,
  defaultSandboxType: "vercel" as const,
  defaultDiffMode: "unified" as const,
  autoCommitPush: false,
  autoCreatePr: false,
  alertsEnabled: true,
  alertSoundEnabled: true,
  publicUsageEnabled: false,
  globalSkillRefs: [] as Array<{ source: string; skillName: string }>,
  modelVariants: [] as Array<Record<string, unknown>>,
  enabledModelIds: [] as string[],
};

const updateCalls: Array<Record<string, unknown>> = [];

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentSession,
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async (_userId: string) => preferencesState,
  updateUserPreferences: async (
    _userId: string,
    updates: Record<string, unknown>,
  ) => {
    updateCalls.push(updates);
    return {
      ...preferencesState,
      ...updates,
    };
  },
}));

const routeModulePromise = import("./route");

function createJsonRequest(method: "PATCH" | "GET", body?: unknown): Request {
  return new Request("http://localhost/api/settings/preferences", {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("/api/settings/preferences", () => {
  beforeEach(() => {
    currentSession = { user: { id: "user-1" } };
    preferencesState.defaultModelId = "anthropic/claude-haiku-4.5";
    preferencesState.defaultSubagentModelId = null;
    preferencesState.modelVariants = [];
    preferencesState.enabledModelIds = [];
    updateCalls.length = 0;
  });

  test("GET returns 401 when unauthenticated", async () => {
    currentSession = null;
    const { GET } = await routeModulePromise;

    const response = await GET(createJsonRequest("GET"));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe("Not authenticated");
  });

  test("GET returns preferences including autoCommitPush and autoCreatePr", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(createJsonRequest("GET"));
    const body = (await response.json()) as {
      preferences: typeof preferencesState;
    };

    expect(response.status).toBe(200);
    expect(body.preferences.autoCommitPush).toBe(false);
    expect(body.preferences.autoCreatePr).toBe(false);
    expect(body.preferences.defaultSandboxType).toBe("vercel");
    expect(body.preferences.globalSkillRefs).toEqual([]);
  });

  test("GET denies hosted users from non-allowed domains", async () => {
    const { GET } = await routeModulePromise;

    currentSession = {
      authProvider: "vercel",
      user: { id: "user-1", email: "person@example.com" },
    };
    preferencesState.defaultModelId = "anthropic/claude-opus-4.6";
    preferencesState.defaultSubagentModelId =
      "variant:builtin:claude-opus-4.6-high";
    preferencesState.modelVariants = [
      {
        id: "variant:user-opus",
        name: "User Opus",
        baseModelId: "anthropic/claude-opus-4.6",
        providerOptions: {},
      },
    ];

    const response = await GET(
      new Request("https://open-agents.dev/api/settings/preferences"),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(body.error).toBe(
      "This hosted deployment only supports approved email domains. Deploy your own copy to use Open Agents with your account.",
    );
  });

  test("PATCH rejects invalid sandbox types", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createJsonRequest("PATCH", { defaultSandboxType: "invalid" }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid sandbox type");
    expect(updateCalls).toHaveLength(0);
  });

  test("PATCH rejects invalid autoCommitPush values", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createJsonRequest("PATCH", { autoCommitPush: "yes" }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid autoCommitPush value");
    expect(updateCalls).toHaveLength(0);
  });

  test("PATCH updates autoCommitPush when boolean is provided", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createJsonRequest("PATCH", { autoCommitPush: true }),
    );
    const body = (await response.json()) as {
      preferences: typeof preferencesState;
    };

    expect(response.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toEqual({ autoCommitPush: true });
    expect(body.preferences.autoCommitPush).toBe(true);
  });

  test("PATCH rejects invalid autoCreatePr values", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createJsonRequest("PATCH", { autoCreatePr: "yes" }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid autoCreatePr value");
    expect(updateCalls).toHaveLength(0);
  });

  test("PATCH updates autoCreatePr when boolean is provided", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createJsonRequest("PATCH", { autoCreatePr: true }),
    );
    const body = (await response.json()) as {
      preferences: typeof preferencesState;
    };

    expect(response.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toEqual({ autoCreatePr: true });
    expect(body.preferences.autoCreatePr).toBe(true);
  });

  test("PATCH rejects invalid publicUsageEnabled values", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createJsonRequest("PATCH", { publicUsageEnabled: "yes" }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid publicUsageEnabled value");
    expect(updateCalls).toHaveLength(0);
  });

  test("PATCH updates publicUsageEnabled when boolean is provided", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createJsonRequest("PATCH", { publicUsageEnabled: true }),
    );
    const body = (await response.json()) as {
      preferences: typeof preferencesState;
    };

    expect(response.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toEqual({ publicUsageEnabled: true });
    expect(body.preferences.publicUsageEnabled).toBe(true);
  });

  test("PATCH rejects invalid globalSkillRefs values", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createJsonRequest("PATCH", {
        globalSkillRefs: [{ source: "vercel/ai", skillName: "bad name" }],
      }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid globalSkillRefs value");
    expect(updateCalls).toHaveLength(0);
  });

  test("PATCH updates globalSkillRefs when valid refs are provided", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      createJsonRequest("PATCH", {
        globalSkillRefs: [
          { source: "vercel/ai", skillName: "ai-sdk" },
          { source: "vercel/ai", skillName: "ai-sdk" },
        ],
      }),
    );
    const body = (await response.json()) as {
      preferences: typeof preferencesState;
    };

    expect(response.status).toBe(200);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toEqual({
      globalSkillRefs: [{ source: "vercel/ai", skillName: "ai-sdk" }],
    });
    expect(body.preferences.globalSkillRefs).toEqual([
      { source: "vercel/ai", skillName: "ai-sdk" },
    ]);
  });

  test("PATCH returns 400 for invalid JSON", async () => {
    const { PATCH } = await routeModulePromise;

    const response = await PATCH(
      new Request("http://localhost/api/settings/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid JSON body");
  });
});
