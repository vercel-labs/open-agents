import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Sandbox } from "@open-harness/sandbox";

mock.module("server-only", () => ({}));

interface TestVercelAuthInfo {
  token: string;
  expiresAt: number;
  externalId: string;
}

let currentAuthInfo: TestVercelAuthInfo | null = null;

mock.module("@/lib/vercel/token", () => ({
  getUserVercelAuthInfo: async () => currentAuthInfo,
}));

const vercelCliAuthModulePromise = import("./vercel-cli-auth");

function createSandbox() {
  const writeFileCalls: Array<{ path: string; content: string }> = [];
  const execCalls: Array<{ command: string; cwd: string; timeoutMs: number }> =
    [];

  const sandbox: Sandbox = {
    type: "cloud",
    workingDirectory: "/workspace",
    exec: async (command, cwd, timeoutMs) => {
      execCalls.push({ command, cwd, timeoutMs });
      if (command === 'printf %s "$HOME"') {
        return {
          success: true,
          exitCode: 0,
          stdout: "/home/tester",
          stderr: "",
          truncated: false,
        };
      }

      return {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        truncated: false,
      };
    },
    writeFile: async (path, content) => {
      writeFileCalls.push({ path, content });
    },
    readFile: async () => {
      throw new Error("not implemented");
    },
    stat: async () => {
      throw new Error("not implemented");
    },
    access: async () => {
      throw new Error("not implemented");
    },
    mkdir: async () => {
      throw new Error("not implemented");
    },
    readdir: async () => {
      throw new Error("not implemented");
    },
    stop: async () => {},
  };

  return {
    sandbox,
    writeFileCalls,
    execCalls,
  };
}

describe("vercel-cli-auth", () => {
  beforeEach(() => {
    currentAuthInfo = {
      token: "vca_token_123",
      expiresAt: 1_700_000_000,
      externalId: "user_ext_123",
    };
  });

  test("builds a team-scoped CLI setup when the session is linked to a team project", async () => {
    const { getVercelCliSandboxSetup } = await vercelCliAuthModulePromise;

    const setup = await getVercelCliSandboxSetup({
      userId: "user-1",
      sessionRecord: {
        vercelProjectId: "prj_123",
        vercelProjectName: "open-harness-web",
        vercelTeamId: "team_123",
      },
    });

    expect(setup).toEqual({
      auth: {
        token: "vca_token_123",
        expiresAt: 1700000000,
      },
      projectLink: {
        orgId: "team_123",
        projectId: "prj_123",
        projectName: "open-harness-web",
      },
    });
  });

  test("falls back to the user's Vercel external ID for personal projects", async () => {
    const { getVercelCliSandboxSetup } = await vercelCliAuthModulePromise;

    const setup = await getVercelCliSandboxSetup({
      userId: "user-1",
      sessionRecord: {
        vercelProjectId: "prj_123",
        vercelProjectName: null,
        vercelTeamId: null,
      },
    });

    expect(setup.projectLink).toEqual({
      orgId: "user_ext_123",
      projectId: "prj_123",
    });
  });

  test("syncs CLI auth and project metadata without persisting a refresh token", async () => {
    const { getVercelCliSandboxSetup, syncVercelCliAuthToSandbox } =
      await vercelCliAuthModulePromise;
    const { sandbox, writeFileCalls, execCalls } = createSandbox();

    const setup = await getVercelCliSandboxSetup({
      userId: "user-1",
      sessionRecord: {
        vercelProjectId: "prj_123",
        vercelProjectName: "open-harness-web",
        vercelTeamId: "team_123",
      },
    });

    await syncVercelCliAuthToSandbox({ sandbox, setup });

    expect(execCalls).toEqual([
      {
        command: 'printf %s "$HOME"',
        cwd: "/workspace",
        timeoutMs: 5000,
      },
    ]);
    expect(writeFileCalls).toEqual([
      {
        path: "/home/tester/.local/share/com.vercel.cli/auth.json",
        content:
          '{\n  "token": "vca_token_123",\n  "expiresAt": 1700000000\n}\n',
      },
      {
        path: "/workspace/.vercel/project.json",
        content:
          '{\n  "orgId": "team_123",\n  "projectId": "prj_123",\n  "projectName": "open-harness-web"\n}\n',
      },
    ]);
    expect(writeFileCalls[0]?.content).not.toContain("refreshToken");
  });

  test("removes stale CLI auth and project metadata when no auth or link is available", async () => {
    currentAuthInfo = null;
    const { getVercelCliSandboxSetup, syncVercelCliAuthToSandbox } =
      await vercelCliAuthModulePromise;
    const { sandbox, writeFileCalls, execCalls } = createSandbox();

    const setup = await getVercelCliSandboxSetup({
      userId: "user-1",
      sessionRecord: {
        vercelProjectId: null,
        vercelProjectName: null,
        vercelTeamId: null,
      },
    });

    await syncVercelCliAuthToSandbox({ sandbox, setup });

    expect(writeFileCalls).toEqual([]);
    expect(execCalls).toEqual([
      {
        command: 'printf %s "$HOME"',
        cwd: "/workspace",
        timeoutMs: 5000,
      },
      {
        command: "rm -f '/home/tester/.local/share/com.vercel.cli/auth.json'",
        cwd: "/workspace",
        timeoutMs: 5000,
      },
      {
        command: "rm -f '/workspace/.vercel/project.json'",
        cwd: "/workspace",
        timeoutMs: 5000,
      },
    ]);
  });
});
