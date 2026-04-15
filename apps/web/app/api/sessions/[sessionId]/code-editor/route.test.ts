import { beforeEach, describe, expect, mock, test } from "bun:test";

const CODE_EDITOR_PID_FILE = "/tmp/open-harness-code-server.pid";
const RUNNING_CODE_SERVER_PID = "9001";

const currentSessionRecord = {
  userId: "user-1",
  sandboxState: {
    type: "vercel" as const,
    sandboxId: "sandbox-1",
    expiresAt: Date.now() + 60_000,
  },
};

let fileContents = new Map<string, string>();
let runningPids = new Set<string>();
let processListOutput = "";
let portProbeStatusCode: string | null = null;
let lastLaunchCommand: string | null = null;
let lastLaunchCwd: string | null = null;
let currentAuthSession: {
  authProvider?: "vercel" | "github";
  user: {
    id: string;
    email?: string;
  };
} | null = null;

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

function removeProcessFromList(pid: string) {
  processListOutput = processListOutput
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(`${pid} `))
    .join("\n");
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
  if (command === "ps -eo pid=,args=") {
    return successResult(processListOutput);
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
      removeProcessFromList(pid);
    }
    return successResult();
  }

  if (command.startsWith("rm -f ")) {
    const filePath = command.match(/^rm -f '(.+)'$/)?.[1];
    if (filePath) {
      fileContents.delete(filePath);
    }
    return successResult();
  }

  if (command.includes("curl -s -o /dev/null")) {
    return portProbeStatusCode === null
      ? failureResult("connection refused")
      : successResult(portProbeStatusCode);
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
const execDetachedMock = mock(async (command: string, cwd: string) => {
  lastLaunchCommand = command;
  lastLaunchCwd = cwd;

  fileContents.set(CODE_EDITOR_PID_FILE, `${RUNNING_CODE_SERVER_PID}\n`);
  runningPids.add(RUNNING_CODE_SERVER_PID);
  processListOutput = ` ${RUNNING_CODE_SERVER_PID} code-server --port 8000 --auth none --bind-addr 0.0.0.0:8000 /vercel/sandbox\n`;

  return { commandId: "cmd-1" };
});
const domainMock = mock((port: number) => `https://sb-${port}.vercel.run`);
const connectSandboxMock = mock(async () => ({
  workingDirectory: "/vercel/sandbox",
  exec: execMock,
  readFile: readFileMock,
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

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentAuthSession,
}));

const routeModulePromise = import("./route");

function createRouteContext(sessionId = "session-1") {
  return {
    params: Promise.resolve({ sessionId }),
  };
}

describe("/api/sessions/[sessionId]/code-editor", () => {
  beforeEach(() => {
    fileContents = new Map<string, string>();
    runningPids = new Set<string>();
    processListOutput = "";
    portProbeStatusCode = null;
    lastLaunchCommand = null;
    lastLaunchCwd = null;
    currentAuthSession = null;
    currentSessionRecord.sandboxState.expiresAt = Date.now() + 60_000;
    requireAuthenticatedUserMock.mockClear();
    requireOwnedSessionWithSandboxGuardMock.mockClear();
    connectSandboxMock.mockClear();
    execMock.mockClear();
    readFileMock.mockClear();
    execDetachedMock.mockClear();
    domainMock.mockClear();
  });

  test("GET ignores unrelated processes that happen to use the editor port", async () => {
    const { GET } = await routeModulePromise;

    processListOutput = " 4321 python -m http.server 8000\n";
    runningPids.add("4321");
    portProbeStatusCode = "200";

    const response = await GET(
      new Request("http://localhost/api/sessions/session-1/code-editor"),
      createRouteContext(),
    );
    const body = (await response.json()) as {
      running: boolean;
      url: string | null;
      port: number;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      running: false,
      url: null,
      port: 8000,
    });
  });

  test("POST returns a conflict instead of opening an unrelated app on the editor port", async () => {
    const { POST } = await routeModulePromise;

    processListOutput = " 4321 python -m http.server 8000\n";
    runningPids.add("4321");
    portProbeStatusCode = "200";

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/code-editor", {
        method: "POST",
      }),
      createRouteContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: "Port 8000 is already in use by another process",
    });
    expect(execDetachedMock).toHaveBeenCalledTimes(0);
  });

  test("POST reuses an existing code-server process found via process list when the pid file is missing", async () => {
    const { POST } = await routeModulePromise;

    processListOutput =
      " 9001 code-server --port 8000 --auth none --bind-addr 0.0.0.0:8000 /vercel/sandbox\n";
    runningPids.add(RUNNING_CODE_SERVER_PID);

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/code-editor", {
        method: "POST",
      }),
      createRouteContext(),
    );
    const body = (await response.json()) as { url: string; port: number };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      url: "https://sb-8000.vercel.run",
      port: 8000,
    });
    expect(execDetachedMock).toHaveBeenCalledTimes(0);
  });

  test("POST returns 403 for managed-template trial users", async () => {
    currentAuthSession = {
      authProvider: "vercel",
      user: {
        id: "user-1",
        email: "person@example.com",
      },
    };
    const { POST } = await routeModulePromise;
    const expectedError =
      "This hosted deployment does not allow the code editor for non-Vercel trial accounts. Deploy your own copy for full controls.";

    const response = await POST(
      new Request(
        "https://open-agents.dev/api/sessions/session-1/code-editor",
        {
          method: "POST",
        },
      ),
      createRouteContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(body.error).toBe(expectedError);
    expect(connectSandboxMock).toHaveBeenCalledTimes(0);
    expect(execDetachedMock).toHaveBeenCalledTimes(0);
  });

  test("DELETE does not claim success when only another app is using the editor port", async () => {
    const { DELETE } = await routeModulePromise;

    processListOutput = " 4321 python -m http.server 8000\n";
    runningPids.add("4321");
    portProbeStatusCode = "200";

    const response = await DELETE(
      new Request("http://localhost/api/sessions/session-1/code-editor", {
        method: "DELETE",
      }),
      createRouteContext(),
    );
    const body = (await response.json()) as { stopped: boolean };

    expect(response.status).toBe(200);
    expect(body).toEqual({ stopped: false });
    expect(runningPids.has("4321")).toBe(true);
  });

  test("POST launches code-server when the port is free", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/code-editor", {
        method: "POST",
      }),
      createRouteContext(),
    );
    const body = (await response.json()) as { url: string; port: number };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      url: "https://sb-8000.vercel.run",
      port: 8000,
    });
    expect(execDetachedMock).toHaveBeenCalledTimes(1);
    expect(lastLaunchCwd).toBe("/vercel/sandbox");
    expect(lastLaunchCommand).toContain("code-server --port 8000");
    expect(fileContents.get(CODE_EDITOR_PID_FILE)).toBe(
      `${RUNNING_CODE_SERVER_PID}\n`,
    );
  });
});
