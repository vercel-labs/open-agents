import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthSession = {
  user: {
    id: string;
  };
} | null;

let authSession: AuthSession;

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => authSession,
}));

const routeModulePromise = import("./route");

function createRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/github/create-repo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/github/create-repo", () => {
  beforeEach(() => {
    authSession = {
      user: {
        id: "user-1",
      },
    };
  });

  test("returns 401 when unauthenticated", async () => {
    authSession = null;
    const { POST } = await routeModulePromise;

    const response = await POST(createRequest({ sessionId: "session-1" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Not authenticated" });
  });

  test("returns 400 for invalid JSON", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/github/create-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON body" });
  });

  test("returns disabled response for authenticated users", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createRequest({
        sessionId: "session-1",
        repoName: "repo-1",
      }),
    );

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({
      error:
        "Creating repositories from Open Agents is temporarily disabled. Create the repository on GitHub first, then connect it to a session.",
    });
  });
});
