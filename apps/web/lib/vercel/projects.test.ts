import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const originalFetch = globalThis.fetch;

const projectsModulePromise = import("./projects");

describe("Vercel project helpers", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("listMatchingVercelProjects dedupes projects and tolerates partial scope failures", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());

      if (url.pathname === "/v2/teams") {
        return Response.json({
          teams: [
            { id: "team-1", slug: "acme" },
            { id: "team-2", slug: "beta" },
          ],
        });
      }

      if (url.pathname === "/v10/projects") {
        const teamId = url.searchParams.get("teamId");
        if (!teamId) {
          return Response.json({
            projects: [
              { id: "project-1", name: "app" },
              { id: "project-2", name: "admin" },
            ],
          });
        }

        if (teamId === "team-1") {
          return Response.json({
            projects: [
              { id: "project-2", name: "admin" },
              { id: "project-3", name: "marketing" },
            ],
          });
        }

        return new Response("team failure", { status: 500 });
      }

      return new Response("Not found", { status: 404 });
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { listMatchingVercelProjects } = await projectsModulePromise;
    const projects = await listMatchingVercelProjects({
      token: "token",
      repoOwner: "vercel",
      repoName: "open-harness",
    });

    expect(projects).toEqual([
      {
        projectId: "project-2",
        projectName: "admin",
        teamId: null,
        teamSlug: null,
      },
      {
        projectId: "project-1",
        projectName: "app",
        teamId: null,
        teamSlug: null,
      },
      {
        projectId: "project-3",
        projectName: "marketing",
        teamId: "team-1",
        teamSlug: "acme",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test("selectDevelopmentEnvVars prefers more specific development targets and newer values", async () => {
    const { selectDevelopmentEnvVars } = await projectsModulePromise;

    const envVars = selectDevelopmentEnvVars([
      {
        key: "PREVIEW_ONLY",
        value: "skip-me",
        target: ["preview"],
      },
      {
        key: "API_URL",
        value: "shared-development",
        target: ["development", "preview"],
        updatedAt: 20,
      },
      {
        key: "API_URL",
        value: "development-specific",
        target: ["development"],
        updatedAt: 10,
      },
      {
        key: "FEATURE_FLAG",
        value: "old",
        target: ["development"],
        updatedAt: 10,
      },
      {
        key: "FEATURE_FLAG",
        value: "new",
        target: ["development"],
        updatedAt: 50,
      },
    ]);

    expect(envVars).toEqual([
      { key: "API_URL", value: "development-specific" },
      { key: "FEATURE_FLAG", value: "new" },
    ]);
  });

  test("serializeEnvVarsToDotenv escapes values and keeps alphabetical order from selection", async () => {
    const { selectDevelopmentEnvVars, serializeEnvVarsToDotenv } =
      await projectsModulePromise;

    const envVars = selectDevelopmentEnvVars([
      {
        key: "MULTILINE",
        value: "line1\nline2",
        target: ["development"],
      },
      {
        key: "ALPHA",
        value: 'quote "value"',
        target: ["development"],
      },
    ]);

    expect(serializeEnvVarsToDotenv(envVars)).toBe(
      'ALPHA="quote \\\"value\\\""\nMULTILINE="line1\\nline2"\n',
    );
  });
});
