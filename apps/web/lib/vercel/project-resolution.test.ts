import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// Track fetch calls
let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
let fetchResponse: { ok: boolean; status: number; body: unknown } = {
  ok: true,
  status: 200,
  body: { projects: [] },
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  fetchCalls.push({ url, init });
  return {
    ok: fetchResponse.ok,
    status: fetchResponse.status,
    text: async () => JSON.stringify(fetchResponse.body),
    json: async () => fetchResponse.body,
  } as Response;
};

const { resolveVercelProject } = await import("./project-resolution");

describe("resolveVercelProject", () => {
  beforeEach(() => {
    fetchCalls = [];
    fetchResponse = { ok: true, status: 200, body: { projects: [] } };
  });

  test("returns project_unresolved when no projects match", async () => {
    fetchResponse = { ok: true, status: 200, body: { projects: [] } };

    const result = await resolveVercelProject({
      vercelToken: "tok_test",
      repoOwner: "acme",
      repoName: "app",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("project_unresolved");
    }

    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0]!.url).toContain("/v10/projects");
    expect(fetchCalls[0]!.url).toContain("repo=acme%2Fapp");
    expect(fetchCalls[0]!.init?.headers).toEqual({
      Authorization: "Bearer tok_test",
    });
  });

  test("returns project info when exactly one project matches", async () => {
    fetchResponse = {
      ok: true,
      status: 200,
      body: {
        projects: [
          {
            id: "prj_123",
            name: "my-app",
            accountId: "team_456",
            link: { type: "github", org: "acme", repo: "app" },
          },
        ],
      },
    };

    const result = await resolveVercelProject({
      vercelToken: "tok_test",
      repoOwner: "acme",
      repoName: "app",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project.projectId).toBe("prj_123");
      expect(result.project.projectName).toBe("my-app");
      expect(result.project.orgId).toBe("team_456");
      expect(result.project.orgSlug).toBe("acme");
    }
  });

  test("returns project_ambiguous when multiple projects match", async () => {
    fetchResponse = {
      ok: true,
      status: 200,
      body: {
        projects: [
          { id: "prj_1", name: "app-1", accountId: "team_1" },
          { id: "prj_2", name: "app-2", accountId: "team_2" },
        ],
      },
    };

    const result = await resolveVercelProject({
      vercelToken: "tok_test",
      repoOwner: "acme",
      repoName: "app",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("project_ambiguous");
      expect(result.message).toContain("2");
    }
  });

  test("returns api_error on non-ok response", async () => {
    fetchResponse = { ok: false, status: 403, body: { error: "forbidden" } };

    const result = await resolveVercelProject({
      vercelToken: "tok_bad",
      repoOwner: "acme",
      repoName: "app",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("api_error");
      expect(result.message).toContain("403");
    }
  });

  test("returns api_error on network failure", async () => {
    // Temporarily override fetch to throw
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("network down");
    };

    const result = await resolveVercelProject({
      vercelToken: "tok_test",
      repoOwner: "acme",
      repoName: "app",
    });

    globalThis.fetch = savedFetch;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("api_error");
      expect(result.message).toContain("network down");
    }
  });

  test("handles project without link/org gracefully", async () => {
    fetchResponse = {
      ok: true,
      status: 200,
      body: {
        projects: [
          {
            id: "prj_solo",
            name: "solo-app",
            accountId: "user_789",
          },
        ],
      },
    };

    const result = await resolveVercelProject({
      vercelToken: "tok_test",
      repoOwner: "user",
      repoName: "solo-app",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project.projectId).toBe("prj_solo");
      expect(result.project.orgId).toBe("user_789");
      expect(result.project.orgSlug).toBeUndefined();
    }
  });
});
