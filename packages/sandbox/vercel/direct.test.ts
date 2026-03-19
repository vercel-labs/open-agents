import { describe, expect, mock, test } from "bun:test";
import type { Sandbox } from "../interface";

let runCommandCalls = 0;

class MockApiClient {
  async runCommand() {
    runCommandCalls += 1;
    throw new Error("Status code 410 is not ok");
  }

  async getSandbox() {
    return {
      json: {
        routes: [],
      },
    };
  }
}

mock.module("@vercel/sandbox/dist/api-client", () => ({
  APIClient: MockApiClient,
}));

mock.module("@vercel/sandbox/dist/utils/get-credentials", () => ({
  getCredentials: async () => ({
    teamId: "team-1",
    token: "token-1",
  }),
}));

const directModulePromise = import("./direct");

function createFallbackSandbox() {
  const sandbox: Sandbox = {
    type: "cloud",
    workingDirectory: "/vercel/sandbox",
    readFile: async () => {
      throw new Error("not implemented");
    },
    writeFile: async () => {
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
    exec: async () => ({
      success: true,
      exitCode: 0,
      stdout: "/vercel/sandbox\n",
      stderr: "",
      truncated: false,
    }),
    stop: async () => {},
  };

  return sandbox;
}

describe("tryConnectVercelSandboxDirect", () => {
  test("falls back to the managed sandbox when direct exec returns a 410", async () => {
    runCommandCalls = 0;

    const { tryConnectVercelSandboxDirect } = await directModulePromise;
    const reconnect = mock(async () => createFallbackSandbox());

    const sandbox = await tryConnectVercelSandboxDirect({
      sandboxId: "sbx-1",
      reconnect,
      expiresAt: Date.now() + 60_000,
    });

    expect(sandbox).not.toBeNull();
    if (!sandbox) {
      throw new Error("Expected a direct sandbox instance");
    }

    const result = await sandbox.exec("pwd", "/vercel/sandbox", 5_000);

    expect(result).toEqual({
      success: true,
      exitCode: 0,
      stdout: "/vercel/sandbox\n",
      stderr: "",
      truncated: false,
    });
    expect(runCommandCalls).toBe(1);
    expect(reconnect).toHaveBeenCalledTimes(1);
  });
});
