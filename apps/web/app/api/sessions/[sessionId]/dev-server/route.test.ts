import { beforeEach, describe, expect, mock, test } from "bun:test";

const DEV_SERVER_PID_FILE =
  "/vercel/sandbox/apps/web/.open-agents-dev-server-3000.pid";
const DEV_SERVER_STATE_FILE =
  "/vercel/sandbox/.open-agents-dev-server-state.json";
const RUNNING_PID = "4242";

const currentSessionRecord = {
  userId: "user-1",
  sandboxState: {
    type: "vercel" as const,
    sandboxId: "sandbox-1",
    expiresAt: Date.now() + 60_000,
  },
};

type MockPathEntry = {
  type: "file" | "directory";
  mtimeMs: number;
  size: number;
};

let currentFindOutput = "./package.json\n./apps/web/package.json\n";
let fileContents = new Map<string, string>();
let existingPaths = new Set<string>();
let pathEntries = new Map<string, MockPathEntry>();
let runningPids = new Set<string>();
let lastLaunchCommand: string | null = null;
let lastLaunchCwd: string | null = null;
let currentMtimeMs = 1_000;

function successResult(stdout = "") {
  return {
    success: true,
    exitCode: 0,
    stdout,
    stderr: "",
    truncated: false,
  };
}

function failureResult(stderr: string) {
  return {
    success: false,
    exitCode: 1,
    stdout: "",
    stderr,
    truncated: false,
  };
}

function nextMtime(): number {
  currentMtimeMs += 100;
  return currentMtimeMs;
}

function setMockFile(filePath: string, content: string, mtimeMs = nextMtime()) {
  fileContents.set(filePath, content);
  existingPaths.add(filePath);
  pathEntries.set(filePath, {
    type: "file",
    mtimeMs,
    size: content.length,
  });
}

function setMockDirectory(dirPath: string, mtimeMs = nextMtime()) {
  existingPaths.add(dirPath);
  pathEntries.set(dirPath, {
    type: "directory",
    mtimeMs,
    size: 0,
  });
}

function removeMockPath(targetPath: string) {
  existingPaths.delete(targetPath);
  fileContents.delete(targetPath);
  pathEntries.delete(targetPath);
}

function seedDefaultWorkspace() {
  currentFindOutput = "./package.json\n./apps/web/package.json\n";

  setMockDirectory("/vercel/sandbox");
  setMockDirectory("/vercel/sandbox/apps");
  setMockDirectory("/vercel/sandbox/apps/web");

  setMockFile(
    "/vercel/sandbox/package.json",
    JSON.stringify({
      packageManager: "bun@1.2.14",
      scripts: {
        dev: "turbo dev",
      },
    }),
  );
  setMockFile(
    "/vercel/sandbox/apps/web/package.json",
    JSON.stringify({
      scripts: {
        dev: "next dev",
      },
      dependencies: {
        next: "15.0.0",
      },
    }),
  );
  setMockFile("/vercel/sandbox/bun.lock", "");
}

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
    return successResult(currentFindOutput);
  }

  if (command.startsWith("kill -0 ")) {
    const pid = command.slice("kill -0 ".length).trim();
    return runningPids.has(pid)
      ? successResult()
      : failureResult(`No such process: ${pid}`);
  }

  if (command.startsWith("kill ")) {
    const pid = command.match(/^kill ([0-9]+)/)?.[1];
    if (pid) {
      runningPids.delete(pid);
    }
    return successResult();
  }

  if (command.startsWith("rm -f ")) {
    const filePath = command.match(/^rm -f '(.+)'$/)?.[1];
    if (filePath) {
      removeMockPath(filePath);
    }
    return successResult();
  }

  throw new Error(`Unexpected exec command: ${command}`);
});
const readFileMock = mock(async (filePath: string) => {
  const content = fileContents.get(filePath);
  if (content === undefined) {
    throw new Error(`Missing file: ${filePath}`);
  }
  return content;
});
const writeFileMock = mock(async (filePath: string, content: string) => {
  setMockFile(filePath, content);
});
const statMock = mock(async (filePath: string) => {
  const entry = pathEntries.get(filePath);
  if (!entry) {
    throw new Error(`ENOENT: ${filePath}`);
  }

  return {
    isDirectory: () => entry.type === "directory",
    isFile: () => entry.type === "file",
    size: entry.size,
    mtimeMs: entry.mtimeMs,
  };
});
const accessMock = mock(async (filePath: string) => {
  if (!existingPaths.has(filePath)) {
    throw new Error(`ENOENT: ${filePath}`);
  }
});
const execDetachedMock = mock(async (command: string, cwd: string) => {
  lastLaunchCommand = command;
  lastLaunchCwd = cwd;

  const pidFilePath = command.match(
    /> '([^']+\.open-agents-dev-server-[0-9]+\.pid)'/,
  )?.[1];
  if (pidFilePath) {
    setMockFile(pidFilePath, `${RUNNING_PID}\n`);
    runningPids.add(RUNNING_PID);
  }

  return { commandId: "cmd-1" };
});
const domainMock = mock((port: number) => `https://sb-${port}.vercel.run`);
const connectSandboxMock = mock(async () => ({
  workingDirectory: "/vercel/sandbox",
  exec: execMock,
  readFile: readFileMock,
  writeFile: writeFileMock,
  stat: statMock,
  access: accessMock,
  execDetached: execDetachedMock,
  domain: domainMock,
}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: requireAuthenticatedUserMock,
  requireOwnedSessionWithSandboxGuard: requireOwnedSessionWithSandboxGuardMock,
}));

mock.module("@open-agents/sandbox", () => ({
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
    currentMtimeMs = 1_000;
    fileContents = new Map();
    existingPaths = new Set<string>();
    pathEntries = new Map<string, MockPathEntry>();
    seedDefaultWorkspace();
    runningPids = new Set<string>();
    lastLaunchCommand = null;
    lastLaunchCwd = null;
    currentSessionRecord.sandboxState.expiresAt = Date.now() + 60_000;
    requireAuthenticatedUserMock.mockClear();
    requireOwnedSessionWithSandboxGuardMock.mockClear();
    connectSandboxMock.mockClear();
    execMock.mockClear();
    readFileMock.mockClear();
    writeFileMock.mockClear();
    statMock.mockClear();
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
      { ports: [3000, 5173, 4321, 8000] },
    );
    expect(execDetachedMock).toHaveBeenCalledTimes(1);
    expect(lastLaunchCwd).toBe("/vercel/sandbox/apps/web");
    expect(lastLaunchCommand).not.toBeNull();
    expect(existingPaths.has(DEV_SERVER_PID_FILE)).toBe(true);
    expect(existingPaths.has(DEV_SERVER_STATE_FILE)).toBe(true);
    expect(fileContents.get(DEV_SERVER_STATE_FILE)).toBe(
      JSON.stringify({ packageDir: "apps/web", port: 3000 }),
    );
    expect(runningPids.has(RUNNING_PID)).toBe(true);

    if (!lastLaunchCommand) {
      throw new Error("Expected execDetached to receive a launch command");
    }

    expect(lastLaunchCommand).toContain(DEV_SERVER_PID_FILE);
    expect(lastLaunchCommand).toContain("bun install");
    expect(lastLaunchCommand).toContain("bun run dev");
    expect(lastLaunchCommand).toContain("--hostname 0.0.0.0 --port 3000");
  });

  test("returns the existing preview URL without relaunching when the dev server is already running", async () => {
    const { POST } = await routeModulePromise;

    setMockFile(DEV_SERVER_PID_FILE, `${RUNNING_PID}\n`);
    setMockFile(
      DEV_SERVER_STATE_FILE,
      JSON.stringify({ packageDir: "apps/web", port: 3000 }),
    );
    runningPids.add(RUNNING_PID);

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
    expect(execDetachedMock).toHaveBeenCalledTimes(0);
  });

  test("keeps using the launched app when package discovery later prefers another app", async () => {
    const { POST } = await routeModulePromise;

    const firstResponse = await POST(
      new Request("http://localhost/api/sessions/session-1/dev-server", {
        method: "POST",
      }),
      createRouteContext(),
    );
    expect(firstResponse.status).toBe(200);

    setMockDirectory("/vercel/sandbox/apps/admin");
    setMockFile(
      "/vercel/sandbox/apps/admin/package.json",
      JSON.stringify({
        scripts: {
          dev: "next dev",
        },
        dependencies: {
          next: "15.0.0",
        },
      }),
    );
    currentFindOutput =
      "./apps/admin/package.json\n./apps/web/package.json\n./package.json\n";

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
    expect(execDetachedMock).toHaveBeenCalledTimes(1);
  });

  test("stops the running dev server even when package discovery later prefers another app", async () => {
    const { DELETE, POST } = await routeModulePromise;

    const launchResponse = await POST(
      new Request("http://localhost/api/sessions/session-1/dev-server", {
        method: "POST",
      }),
      createRouteContext(),
    );
    expect(launchResponse.status).toBe(200);

    setMockDirectory("/vercel/sandbox/apps/admin");
    setMockFile(
      "/vercel/sandbox/apps/admin/package.json",
      JSON.stringify({
        scripts: {
          dev: "next dev",
        },
        dependencies: {
          next: "15.0.0",
        },
      }),
    );
    currentFindOutput =
      "./apps/admin/package.json\n./apps/web/package.json\n./package.json\n";

    const response = await DELETE(
      new Request("http://localhost/api/sessions/session-1/dev-server", {
        method: "DELETE",
      }),
      createRouteContext(),
    );
    const body = (await response.json()) as {
      stopped: boolean;
      packagePath: string;
      port: number;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      stopped: true,
      packagePath: "apps/web",
      port: 3000,
    });
    expect(runningPids.has(RUNNING_PID)).toBe(false);
    expect(existingPaths.has(DEV_SERVER_PID_FILE)).toBe(false);
    expect(existingPaths.has(DEV_SERVER_STATE_FILE)).toBe(false);
  });

  test("reinstalls dependencies when a package manifest changed after node_modules was created", async () => {
    const { POST } = await routeModulePromise;

    setMockDirectory("/vercel/sandbox/node_modules", 5_000);
    setMockFile(
      "/vercel/sandbox/apps/web/package.json",
      JSON.stringify({
        scripts: {
          dev: "next dev",
        },
        dependencies: {
          next: "15.0.0",
          react: "19.0.0",
        },
      }),
      6_000,
    );

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/dev-server", {
        method: "POST",
      }),
      createRouteContext(),
    );

    expect(response.status).toBe(200);
    expect(lastLaunchCommand).not.toBeNull();

    if (!lastLaunchCommand) {
      throw new Error("Expected execDetached to receive a launch command");
    }

    expect(lastLaunchCommand).toContain("bun install");
  });

  test("skips dependency install when node_modules is newer than manifests and lockfiles", async () => {
    const { POST } = await routeModulePromise;

    setMockDirectory("/vercel/sandbox/node_modules", 10_000);

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/dev-server", {
        method: "POST",
      }),
      createRouteContext(),
    );

    expect(response.status).toBe(200);
    expect(lastLaunchCommand).not.toBeNull();

    if (!lastLaunchCommand) {
      throw new Error("Expected execDetached to receive a launch command");
    }

    expect(lastLaunchCommand).not.toContain("bun install");
  });

  test("returns 404 when no supported dev script is found", async () => {
    const { POST } = await routeModulePromise;

    fileContents = new Map();
    existingPaths = new Set<string>();
    pathEntries = new Map<string, MockPathEntry>();
    setMockDirectory("/vercel/sandbox");
    setMockFile(
      "/vercel/sandbox/package.json",
      JSON.stringify({
        scripts: {
          test: "bun test",
        },
      }),
    );
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
