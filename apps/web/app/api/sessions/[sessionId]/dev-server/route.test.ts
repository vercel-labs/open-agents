import { beforeEach, describe, expect, mock, test } from "bun:test";

const currentSessionRecord = {
  userId: "user-1",
  sandboxState: {
    type: "vercel" as const,
    sandboxId: "sandbox-1",
    expiresAt: Date.now() + 60_000,
  },
};

let currentFindOutput = "./package.json\n./apps/web/package.json\n";
let fileContents = new Map<string, string>();
let existingPaths = new Set<string>();
let lastLaunchCommand: string | null = null;
let lastLaunchCwd: string | null = null;

const requireAuthenticatedUserMock = mock(async () => ({
  ok: true as const,
  userId: "user-1",
}));
const requireOwnedSessionWithSandboxGuardMock = mock(async () => ({
  ok: true as const,
  sessionRecord: currentSessionRecord,
}));
const execMock = mock(async (command: string) => {
  if (command.includes("find .")) {
    return {
      success: true,
      exitCode: 0,
      stdout: currentFindOutput,
      stderr: "",
      truncated: false,
    };
  }

  throw new Error(`Unexpected exec command: ${command}`);
});
const readFileMock = mock(async (filePath: string) => {
  const content = fileContents.get(filePath);
  if (!content) {
    throw new Error(`Missing file: ${filePath}`);
  }
  return content;
});
const accessMock = mock(async (filePath: string) => {
  if (!existingPaths.has(filePath)) {
    throw new Error(`ENOENT: ${filePath}`);
  }
});
const execDetachedMock = mock(async (command: string, cwd: string) => {
  lastLaunchCommand = command;
  lastLaunchCwd = cwd;
  return { commandId: "cmd-1" };
});
const domainMock = mock((port: number) => `https://sb-${port}.vercel.run`);
const connectSandboxMock = mock(async () => ({
  workingDirectory: "/vercel/sandbox",
  exec: execMock,
  readFile: readFileMock,
  access: accessMock,
  execDetached: execDetachedMock,
  domain: domainMock,
}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: requireAuthenticatedUserMock,
  requireOwnedSessionWithSandboxGuard: requireOwnedSessionWithSandboxGuardMock,
}));

mock.module("@open-harness/sandbox", () => ({
  connectSandbox: connectSandboxMock,
}));

const routeModulePromise = import("./route");

function createRouteContext(sessionId = "session-1") {
  return {
    params: Promise.resolve({ sessionId }),
  };
}

describe("/api/sessions/[sessionId]/dev-server", () => {
  beforeEach(() => {
    currentFindOutput = "./package.json\n./apps/web/package.json\n";
    fileContents = new Map([
      [
        "/vercel/sandbox/package.json",
        JSON.stringify({
          packageManager: "bun@1.2.14",
          scripts: {
            dev: "turbo dev",
          },
        }),
      ],
      [
        "/vercel/sandbox/apps/web/package.json",
        JSON.stringify({
          scripts: {
            dev: "next dev",
          },
          dependencies: {
            next: "15.0.0",
          },
        }),
      ],
    ]);
    existingPaths = new Set(["/vercel/sandbox/bun.lock"]);
    lastLaunchCommand = null;
    lastLaunchCwd = null;
    currentSessionRecord.sandboxState.expiresAt = Date.now() + 60_000;
    requireAuthenticatedUserMock.mockClear();
    requireOwnedSessionWithSandboxGuardMock.mockClear();
    connectSandboxMock.mockClear();
    execMock.mockClear();
    readFileMock.mockClear();
    accessMock.mockClear();
    execDetachedMock.mockClear();
    domainMock.mockClear();
  });

  test("prefers a direct app dev script over a root workspace orchestrator and returns its preview URL", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/dev-server", {
        method: "POST",
      }),
      createRouteContext(),
    );
    const body = (await response.json()) as {
      packagePath: string;
      port: number;
      url: string;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      packagePath: "apps/web",
      port: 3000,
      url: "https://sb-3000.vercel.run",
    });
    expect(connectSandboxMock).toHaveBeenCalledWith(
      currentSessionRecord.sandboxState,
      { ports: [3000, 5173, 4321] },
    );
    expect(execDetachedMock).toHaveBeenCalledTimes(1);

    expect(lastLaunchCwd).toBe("/vercel/sandbox/apps/web");
    expect(lastLaunchCommand).not.toBeNull();
    if (!lastLaunchCommand) {
      throw new Error("Expected execDetached to receive a launch command");
    }

    expect(lastLaunchCommand).toContain("bun install");
    expect(lastLaunchCommand).toContain("bun run dev");
    expect(lastLaunchCommand).toContain("--hostname 0.0.0.0 --port 3000");
  });

  test("returns 404 when no supported dev script is found", async () => {
    const { POST } = await routeModulePromise;

    fileContents = new Map([
      [
        "/vercel/sandbox/package.json",
        JSON.stringify({
          scripts: {
            test: "bun test",
          },
        }),
      ],
    ]);
    currentFindOutput = "./package.json\n";

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/dev-server", {
        method: "POST",
      }),
      createRouteContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe(
      "No supported dev script found in package.json files",
    );
    expect(execDetachedMock).toHaveBeenCalledTimes(0);
  });
});
