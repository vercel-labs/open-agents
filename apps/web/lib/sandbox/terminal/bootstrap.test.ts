import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("node:crypto", () => ({
  randomUUID: () => "launch-token",
}));
mock.module("node:timers/promises", () => ({
  setTimeout: async () => undefined,
}));

type FakeSandbox = {
  access: (path: string) => Promise<void>;
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  writeFile: (
    path: string,
    content: string,
    encoding: "utf-8",
  ) => Promise<void>;
  exec: (
    command: string,
    cwd: string,
    timeoutMs: number,
  ) => Promise<{
    success: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }>;
  execDetached?: (
    command: string,
    cwd: string,
  ) => Promise<{ commandId: string }>;
  domain?: (port: number) => string;
};

let existingPaths = new Set<string>();
let healthcheckResults: Array<{ ok: boolean; version?: string | null }> = [];
let sandboxDomain: string | null = "https://terminal.vercel.run";
let installShouldFail = false;
const CURRENT_TERMINAL_SERVER_VERSION = "2026-03-24-dist-assets-v2";
const connectCalls: Array<{ state: unknown; options: unknown }> = [];
const mkdirCalls: Array<{ path: string; options?: { recursive?: boolean } }> =
  [];
const writeFileCalls: Array<{
  path: string;
  content: string;
  encoding: string;
}> = [];
const execCalls: Array<{ command: string; cwd: string; timeoutMs: number }> =
  [];
const execDetachedCalls: Array<{ command: string; cwd: string }> = [];

const fakeSandbox: FakeSandbox = {
  access: async (path: string) => {
    if (!existingPaths.has(path)) {
      throw new Error(`ENOENT: ${path}`);
    }
  },
  mkdir: async (path: string, options?: { recursive?: boolean }) => {
    mkdirCalls.push({ path, options });
  },
  writeFile: async (path: string, content: string, encoding: "utf-8") => {
    writeFileCalls.push({ path, content, encoding });
    existingPaths.add(path);
  },
  exec: async (command: string, cwd: string, timeoutMs: number) => {
    execCalls.push({ command, cwd, timeoutMs });

    if (command.startsWith("npm install")) {
      if (installShouldFail) {
        return {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: "install failed",
        };
      }

      existingPaths.add("/tmp/open-harness-terminal/node_modules/ghostty-web");
      existingPaths.add("/tmp/open-harness-terminal/node_modules/ws");
      existingPaths.add(
        "/tmp/open-harness-terminal/node_modules/@lydell/node-pty",
      );
      return {
        success: true,
        exitCode: 0,
        stdout: "installed",
        stderr: "",
      };
    }

    return {
      success: true,
      exitCode: 0,
      stdout: "stopped",
      stderr: "",
    };
  },
  execDetached: async (command: string, cwd: string) => {
    execDetachedCalls.push({ command, cwd });
    return { commandId: "cmd-1" };
  },
  domain: (port: number) => {
    if (sandboxDomain === null || port !== 7681) {
      throw new Error("No route for port");
    }
    return sandboxDomain;
  },
};

const fetchMock = mock(async () => {
  const nextResult = healthcheckResults.shift();
  if (nextResult?.ok) {
    return new Response(
      JSON.stringify({ ok: true, version: nextResult.version ?? null }),
      { status: 200 },
    );
  }
  return new Response(JSON.stringify({ ok: false }), { status: 503 });
});

globalThis.fetch = fetchMock as unknown as typeof fetch;

mock.module("@open-harness/sandbox", () => ({
  connectSandbox: async (state: unknown, options: unknown) => {
    connectCalls.push({ state, options });
    return fakeSandbox;
  },
}));

let importVersion = 0;

async function loadBootstrapModule() {
  importVersion += 1;
  return import(`./bootstrap?test=${importVersion}`);
}

describe("bootstrapSessionTerminal", () => {
  beforeEach(() => {
    existingPaths = new Set();
    healthcheckResults = [];
    sandboxDomain = "https://terminal.vercel.run";
    installShouldFail = false;
    connectCalls.length = 0;
    mkdirCalls.length = 0;
    writeFileCalls.length = 0;
    execCalls.length = 0;
    execDetachedCalls.length = 0;
    fetchMock.mockClear();
  });

  test("returns requires_restart when the terminal port is not routable", async () => {
    sandboxDomain = null;
    const { bootstrapSessionTerminal } = await loadBootstrapModule();

    const result = await bootstrapSessionTerminal({
      id: "session-1",
      sandboxState: { type: "vercel", sandboxId: "sbx-1" },
    } as never);

    expect(result).toEqual({
      status: "requires_restart",
      message:
        "This sandbox was created before terminal routing was enabled. Restart the sandbox once to open a terminal.",
    });
    expect(writeFileCalls).toHaveLength(0);
  });

  test("writes a fresh launch token and returns the terminal url when the server is already healthy", async () => {
    healthcheckResults = [
      { ok: true, version: CURRENT_TERMINAL_SERVER_VERSION },
    ];
    const { bootstrapSessionTerminal } = await loadBootstrapModule();

    const result = await bootstrapSessionTerminal({
      id: "session-1",
      sandboxState: { type: "vercel", sandboxId: "sbx-1" },
    } as never);

    expect(result).toEqual({
      status: "ready",
      terminalUrl: "https://terminal.vercel.run/#token=launch-token",
    });
    expect(connectCalls[0]?.options).toEqual({
      env: {
        OPEN_HARNESS_TERMINAL_CWD: "/vercel/sandbox",
        OPEN_HARNESS_TERMINAL_PORT: "7681",
        OPEN_HARNESS_TERMINAL_TOKEN_FILE: "/tmp/open-harness-terminal/token",
      },
      ports: [3000, 5173, 4321, 7681],
    });
    expect(writeFileCalls.map((call) => call.path)).toEqual([
      "/tmp/open-harness-terminal/package.json",
      "/tmp/open-harness-terminal/server.mjs",
      "/tmp/open-harness-terminal/token",
    ]);
    expect(writeFileCalls[2]?.content).toBe("launch-token");
    expect(execCalls).toHaveLength(0);
    expect(execDetachedCalls).toHaveLength(0);
  });

  test("restarts an already-running terminal server when it is on an older version", async () => {
    existingPaths.add("/tmp/open-harness-terminal/node_modules/ghostty-web");
    existingPaths.add("/tmp/open-harness-terminal/node_modules/ws");
    existingPaths.add(
      "/tmp/open-harness-terminal/node_modules/@lydell/node-pty",
    );
    healthcheckResults = [
      { ok: true, version: "old-version" },
      { ok: true, version: CURRENT_TERMINAL_SERVER_VERSION },
    ];
    const { bootstrapSessionTerminal } = await loadBootstrapModule();

    const result = await bootstrapSessionTerminal({
      id: "session-1",
      sandboxState: { type: "vercel", sandboxId: "sbx-1" },
    } as never);

    expect(result.status).toBe("ready");
    expect(execCalls).toEqual([
      {
        command: 'pkill -f "/tmp/open-harness-terminal/server.mjs" || true',
        cwd: "/vercel/sandbox",
        timeoutMs: 15000,
      },
    ]);
    expect(execDetachedCalls).toEqual([
      {
        command:
          'node server.mjs > "/tmp/open-harness-terminal/server.log" 2>&1',
        cwd: "/tmp/open-harness-terminal",
      },
    ]);
  });

  test("installs runtime dependencies and starts the terminal server when health checks fail", async () => {
    healthcheckResults = [
      { ok: false },
      { ok: false },
      { ok: true, version: CURRENT_TERMINAL_SERVER_VERSION },
    ];
    const { bootstrapSessionTerminal } = await loadBootstrapModule();

    const result = await bootstrapSessionTerminal({
      id: "session-1",
      sandboxState: { type: "vercel", sandboxId: "sbx-1" },
    } as never);

    expect(result.status).toBe("ready");
    expect(execCalls).toEqual([
      {
        command: "npm install --omit=dev --no-audit --no-fund",
        cwd: "/tmp/open-harness-terminal",
        timeoutMs: 600000,
      },
      {
        command: 'pkill -f "/tmp/open-harness-terminal/server.mjs" || true',
        cwd: "/vercel/sandbox",
        timeoutMs: 15000,
      },
    ]);
    expect(execDetachedCalls).toEqual([
      {
        command:
          'node server.mjs > "/tmp/open-harness-terminal/server.log" 2>&1',
        cwd: "/tmp/open-harness-terminal",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("throws when dependency installation fails", async () => {
    healthcheckResults = [{ ok: false }];
    installShouldFail = true;
    const { bootstrapSessionTerminal } = await loadBootstrapModule();

    await expect(
      bootstrapSessionTerminal({
        id: "session-1",
        sandboxState: { type: "vercel", sandboxId: "sbx-1" },
      } as never),
    ).rejects.toThrow("Failed to install terminal runtime dependencies");
  });
});
