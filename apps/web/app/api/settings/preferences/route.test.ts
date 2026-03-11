import { beforeEach, describe, expect, mock, test } from "bun:test";

let currentSession: { user: { id: string } } | null = {
  user: { id: "user-1" },
};

const preferencesState = {
  defaultModelId: "anthropic/claude-haiku-4.5",
  defaultSubagentModelId: null as string | null,
  defaultSandboxType: "vercel" as const,
  autoCommitPush: false,
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
    updateCalls.length = 0;
  });

  test("GET returns 401 when unauthenticated", async () => {
    currentSession = null;
    const { GET } = await routeModulePromise;

    const response = await GET();
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe("Not authenticated");
  });

  test("GET returns preferences including autoCommitPush", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET();
    const body = (await response.json()) as {
      preferences: typeof preferencesState;
    };

    expect(response.status).toBe(200);
    expect(body.preferences.autoCommitPush).toBe(false);
    expect(body.preferences.defaultSandboxType).toBe("vercel");
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
