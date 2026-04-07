import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { SkillMetadata } from "@open-harness/agent";

mock.module("server-only", () => ({}));

interface TestSandboxState {
  type: string;
  sandboxId?: string;
  snapshotId?: string;
  files?: Record<string, unknown>;
}

interface TestSessionRecord {
  id: string;
  userId: string;
  sandboxState: TestSandboxState | null;
}

const cacheReadCalls: Array<{
  sessionId: string;
  sandboxState: TestSandboxState | null;
}> = [];
const cacheWriteCalls: Array<{
  sessionId: string;
  sandboxState: TestSandboxState | null;
  skills: SkillMetadata[];
}> = [];
const connectCalls: TestSandboxState[] = [];
const discoverCalls: Array<{ skillDirs: string[] }> = [];
const updateCalls: Array<Record<string, unknown>> = [];

let sessionRecord: TestSessionRecord;
let cachedSkills: SkillMetadata[] | null;
let discoveredSkills: SkillMetadata[];
let isAuthenticated = true;

function registerRouteMocks() {
  mock.module("@/app/api/sessions/_lib/session-context", () => ({
    requireAuthenticatedUser: async () =>
      isAuthenticated
        ? {
            ok: true as const,
            userId: "user-1",
          }
        : {
            ok: false as const,
            response: Response.json(
              { error: "Not authenticated" },
              { status: 401 },
            ),
          },
    requireOwnedSession: async ({
      userId,
      sessionId,
    }: {
      userId: string;
      sessionId: string;
    }) => {
      if (!sessionRecord || sessionRecord.id !== sessionId) {
        return {
          ok: false as const,
          response: Response.json(
            { error: "Session not found" },
            { status: 404 },
          ),
        };
      }

      if (sessionRecord.userId !== userId) {
        return {
          ok: false as const,
          response: Response.json({ error: "Forbidden" }, { status: 403 }),
        };
      }

      return {
        ok: true as const,
        sessionRecord,
      };
    },
  }));

  mock.module("@/lib/db/sessions", () => ({
    updateSession: async (
      _sessionId: string,
      patch: Record<string, unknown>,
    ) => {
      updateCalls.push(patch);
      return {
        ...sessionRecord,
        ...patch,
      };
    },
  }));

  mock.module("@/lib/skills-cache", () => ({
    getCachedSkills: async (
      sessionId: string,
      sandboxState: TestSandboxState | null,
    ) => {
      cacheReadCalls.push({ sessionId, sandboxState });
      return cachedSkills;
    },
    setCachedSkills: async (
      sessionId: string,
      sandboxState: TestSandboxState | null,
      skills: SkillMetadata[],
    ) => {
      cacheWriteCalls.push({ sessionId, sandboxState, skills });
    },
  }));

  mock.module("@/lib/sandbox/lifecycle", () => ({
    buildHibernatedLifecycleUpdate: () => ({ lifecycleState: "hibernated" }),
  }));

  mock.module("@/lib/sandbox/utils", () => ({
    clearSandboxState: () => null,
    clearUnavailableSandboxState: () => null,
    hasRuntimeSandboxState: (state: TestSandboxState | null) => {
      if (!state) {
        return false;
      }

      return (
        (typeof state.sandboxId === "string" && state.sandboxId.length > 0) ||
        state.files !== undefined
      );
    },
    isSandboxUnavailableError: () => false,
  }));

  mock.module("@open-harness/sandbox", () => ({
    connectSandbox: async (sandboxState: TestSandboxState) => {
      connectCalls.push(sandboxState);
      return {
        workingDirectory: "/workspace",
        exec: async (command: string) => ({
          success: command === 'printf %s "$HOME"',
          exitCode: 0,
          stdout: command === 'printf %s "$HOME"' ? "/root" : "",
          stderr: "",
          truncated: false,
        }),
      };
    },
  }));

  mock.module("@open-harness/agent", () => ({
    discoverSkills: async (_sandbox: unknown, skillDirs: string[]) => {
      discoverCalls.push({ skillDirs });
      return discoveredSkills;
    },
  }));
}

let routeImportVersion = 0;

async function loadRouteModule() {
  routeImportVersion += 1;
  return import(`./route?test=${routeImportVersion}`);
}

describe("/api/sessions/[sessionId]/skills", () => {
  beforeEach(() => {
    cacheReadCalls.length = 0;
    cacheWriteCalls.length = 0;
    connectCalls.length = 0;
    discoverCalls.length = 0;
    updateCalls.length = 0;
    isAuthenticated = true;
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      sandboxState: {
        type: "vercel",
        sandboxId: "sbx-123",
      },
    };
    cachedSkills = null;
    discoveredSkills = [];
    registerRouteMocks();
  });

  test("returns cached suggestions without connecting to the sandbox", async () => {
    sessionRecord.sandboxState = {
      type: "vercel",
      snapshotId: "snap-123",
    };
    cachedSkills = [
      {
        name: "ship",
        description: "Deploy the current project",
        path: "/workspace/.agents/skills/ship",
        filename: "SKILL.md",
        options: {},
      },
      {
        name: "internal",
        description: "Hidden skill",
        path: "/workspace/.agents/skills/internal",
        filename: "SKILL.md",
        options: {
          userInvocable: false,
        },
      },
    ];

    const { GET } = await loadRouteModule();
    const response = await GET(
      new Request("http://localhost/api/sessions/session-1/skills"),
      {
        params: Promise.resolve({ sessionId: "session-1" }),
      },
    );

    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({
      skills: [
        {
          name: "ship",
          description: "Deploy the current project",
        },
      ],
    });
    expect(cacheReadCalls).toEqual([
      {
        sessionId: "session-1",
        sandboxState: {
          type: "vercel",
          snapshotId: "snap-123",
        },
      },
    ]);
    expect(connectCalls).toHaveLength(0);
    expect(discoverCalls).toHaveLength(0);
    expect(cacheWriteCalls).toHaveLength(0);
  });

  test("refresh bypasses the cache and repopulates it from discovery", async () => {
    cachedSkills = [
      {
        name: "stale",
        description: "Old cached skill",
        path: "/workspace/.agents/skills/stale",
        filename: "SKILL.md",
        options: {},
      },
    ];
    discoveredSkills = [
      {
        name: "fresh",
        description: "Freshly discovered skill",
        path: "/workspace/.agents/skills/fresh",
        filename: "SKILL.md",
        options: {},
      },
    ];

    const { GET } = await loadRouteModule();
    const response = await GET(
      new Request("http://localhost/api/sessions/session-1/skills?refresh=1"),
      {
        params: Promise.resolve({ sessionId: "session-1" }),
      },
    );

    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({
      skills: [
        {
          name: "fresh",
          description: "Freshly discovered skill",
        },
      ],
    });
    expect(cacheReadCalls).toHaveLength(0);
    expect(connectCalls).toEqual([
      {
        type: "vercel",
        sandboxId: "sbx-123",
      },
    ]);
    expect(discoverCalls).toEqual([
      {
        skillDirs: [
          "/workspace/.claude/skills",
          "/workspace/.agents/skills",
          "/root/.agents/skills",
        ],
      },
    ]);
    expect(cacheWriteCalls).toEqual([
      {
        sessionId: "session-1",
        sandboxState: {
          type: "vercel",
          sandboxId: "sbx-123",
        },
        skills: discoveredSkills,
      },
    ]);
  });
});
