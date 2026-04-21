import { beforeEach, describe, expect, mock, test } from "bun:test";

type ExecResult = {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
};

function successResult(stdout = ""): ExecResult {
  return {
    success: true,
    exitCode: 0,
    stdout,
    stderr: "",
    truncated: false,
  };
}

function failureResult(stderr = "Git command failed"): ExecResult {
  return {
    success: false,
    exitCode: 1,
    stdout: "",
    stderr,
    truncated: false,
  };
}

const requireAuthenticatedUserMock = mock(async () => ({
  ok: true as const,
  userId: "user-1",
}));
const requireOwnedSessionWithSandboxGuardMock = mock(async () => ({
  ok: true as const,
  sessionRecord: {
    sandboxState: {
      type: "vercel" as const,
      sandboxId: "sandbox-1",
      expiresAt: Date.now() + 60_000,
    },
  },
}));

const execCalls: string[] = [];
const execMock = mock(async (command: string) => {
  execCalls.push(command);

  if (command === "git rev-parse --show-toplevel") {
    return successResult("/workspace\n");
  }

  if (command === "git rev-parse --verify HEAD") {
    return successResult("abc123\n");
  }

  if (command === "git status --porcelain=v1 -- 'tracked-file.txt'") {
    return successResult(" M tracked-file.txt\n");
  }

  if (command === "git ls-files --error-unmatch -- 'tracked-file.txt'") {
    return successResult("tracked-file.txt\n");
  }

  if (
    command ===
    "git restore --source=HEAD --staged --worktree -- 'tracked-file.txt'"
  ) {
    return successResult();
  }

  if (command === "git status --porcelain -- 'tracked-file.txt'") {
    return successResult();
  }

  if (command === "git status --porcelain=v1 -- 'new-file.txt'") {
    return successResult("?? new-file.txt\n");
  }

  if (command === "git ls-files --error-unmatch -- 'new-file.txt'") {
    return failureResult(
      "error: pathspec 'new-file.txt' did not match any file(s) known to git",
    );
  }

  if (command === "rm -rf -- 'new-file.txt'") {
    return successResult();
  }

  if (command === "git status --porcelain -- 'new-file.txt'") {
    return successResult();
  }

  if (command === "git status --porcelain=v1 -- 'clean-file.txt'") {
    return successResult();
  }

  throw new Error(`Unexpected exec command: ${command}`);
});
const connectSandboxMock = mock(async () => ({
  workingDirectory: "/workspace",
  exec: execMock,
}));

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: requireAuthenticatedUserMock,
  requireOwnedSessionWithSandboxGuard: requireOwnedSessionWithSandboxGuardMock,
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: connectSandboxMock,
}));

let routeImportVersion = 0;

async function loadRouteModule() {
  routeImportVersion += 1;
  return import(`./route?test=${routeImportVersion}`);
}

function createContext(sessionId = "session-1") {
  return {
    params: Promise.resolve({ sessionId }),
  };
}

describe("/api/sessions/[sessionId]/discard-uncommitted", () => {
  beforeEach(() => {
    execCalls.length = 0;
    requireAuthenticatedUserMock.mockClear();
    requireOwnedSessionWithSandboxGuardMock.mockClear();
    connectSandboxMock.mockClear();
    execMock.mockClear();
  });

  test("discards a tracked modified file via git restore without deleting it", async () => {
    const { POST } = await loadRouteModule();

    const response = await POST(
      new Request(
        "http://localhost/api/sessions/session-1/discard-uncommitted",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filePath: "tracked-file.txt" }),
        },
      ),
      createContext(),
    );

    const body = (await response.json()) as {
      discarded: boolean;
      hasUncommittedChanges: boolean;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      discarded: true,
      hasUncommittedChanges: false,
    });
    expect(execCalls).toEqual([
      "git rev-parse --show-toplevel",
      "git rev-parse --verify HEAD",
      "git status --porcelain=v1 -- 'tracked-file.txt'",
      "git ls-files --error-unmatch -- 'tracked-file.txt'",
      "git restore --source=HEAD --staged --worktree -- 'tracked-file.txt'",
      "git status --porcelain -- 'tracked-file.txt'",
    ]);
  });

  test("discards an untracked file by deleting it directly", async () => {
    const { POST } = await loadRouteModule();

    const response = await POST(
      new Request(
        "http://localhost/api/sessions/session-1/discard-uncommitted",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filePath: "new-file.txt" }),
        },
      ),
      createContext(),
    );

    const body = (await response.json()) as {
      discarded: boolean;
      hasUncommittedChanges: boolean;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      discarded: true,
      hasUncommittedChanges: false,
    });
    expect(execCalls).toEqual([
      "git rev-parse --show-toplevel",
      "git rev-parse --verify HEAD",
      "git status --porcelain=v1 -- 'new-file.txt'",
      "git ls-files --error-unmatch -- 'new-file.txt'",
      "rm -rf -- 'new-file.txt'",
      "git status --porcelain -- 'new-file.txt'",
    ]);
  });

  test("rejects invalid JSON instead of discarding the whole repo", async () => {
    const { POST } = await loadRouteModule();

    const response = await POST(
      new Request(
        "http://localhost/api/sessions/session-1/discard-uncommitted",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{",
        },
      ),
      createContext(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON body" });
    expect(execCalls).toEqual([]);
    expect(connectSandboxMock).not.toHaveBeenCalled();
  });

  test("rejects file-scoped requests with an empty file path", async () => {
    const { POST } = await loadRouteModule();

    const response = await POST(
      new Request(
        "http://localhost/api/sessions/session-1/discard-uncommitted",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filePath: "" }),
        },
      ),
      createContext(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid file path" });
    expect(execCalls).toEqual([]);
    expect(connectSandboxMock).not.toHaveBeenCalled();
  });

  test("rejects git internals for file-scoped requests", async () => {
    const { POST } = await loadRouteModule();

    const response = await POST(
      new Request(
        "http://localhost/api/sessions/session-1/discard-uncommitted",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filePath: ".git/config" }),
        },
      ),
      createContext(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid file path" });
    expect(execCalls).toEqual([]);
    expect(connectSandboxMock).not.toHaveBeenCalled();
  });

  test("rejects file-scoped requests for paths without uncommitted changes", async () => {
    const { POST } = await loadRouteModule();

    const response = await POST(
      new Request(
        "http://localhost/api/sessions/session-1/discard-uncommitted",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filePath: "clean-file.txt" }),
        },
      ),
      createContext(),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Path has no uncommitted changes",
    });
    expect(execCalls).toEqual([
      "git rev-parse --show-toplevel",
      "git rev-parse --verify HEAD",
      "git status --porcelain=v1 -- 'clean-file.txt'",
    ]);
  });

  test("rejects oldPath without filePath instead of discarding the whole repo", async () => {
    const { POST } = await loadRouteModule();

    const response = await POST(
      new Request(
        "http://localhost/api/sessions/session-1/discard-uncommitted",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldPath: "renamed-file.txt" }),
        },
      ),
      createContext(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "filePath is required when oldPath is provided",
    });
    expect(execCalls).toEqual([]);
    expect(connectSandboxMock).not.toHaveBeenCalled();
  });
});
