import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthResult =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: Response;
    };

type TestSandboxState = {
  type: string;
  sandboxId?: string;
};

type OwnedSessionResult =
  | {
      ok: true;
      sessionRecord: {
        id: string;
        userId: string;
        sandboxState: TestSandboxState | null;
      };
    }
  | {
      ok: false;
      response: Response;
    };

type TestStats = {
  isDirectory(): boolean;
  isFile(): boolean;
  size: number;
};

const connectCalls: TestSandboxState[] = [];
const statCalls: string[] = [];
const readFileCalls: Array<{ path: string; encoding: "utf-8" }> = [];
const updateCalls: Array<{
  sessionId: string;
  patch: Record<string, unknown>;
}> = [];

let authResult: AuthResult = { ok: true, userId: "user-1" };
let ownedSessionResult: OwnedSessionResult = {
  ok: true,
  sessionRecord: {
    id: "session-1",
    userId: "user-1",
    sandboxState: {
      type: "vercel",
      sandboxId: "sbx-1",
    },
  },
};
let connectSandboxError: Error | null = null;
let statImplementation: (path: string) => Promise<TestStats>;
let readFileImplementation: (
  path: string,
  encoding: "utf-8",
) => Promise<string>;

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
  requireOwnedSessionWithSandboxGuard: async () => ownedSessionResult,
}));

mock.module("@open-harness/sandbox", () => ({
  connectSandbox: async (sandboxState: TestSandboxState) => {
    if (connectSandboxError) {
      throw connectSandboxError;
    }

    connectCalls.push(sandboxState);
    return {
      workingDirectory: "/workspace",
      stat: async (path: string) => {
        statCalls.push(path);
        return statImplementation(path);
      },
      readFile: async (path: string, encoding: "utf-8") => {
        readFileCalls.push({ path, encoding });
        return readFileImplementation(path, encoding);
      },
    };
  },
}));

mock.module("@/lib/db/sessions", () => ({
  updateSession: async (sessionId: string, patch: Record<string, unknown>) => {
    updateCalls.push({ sessionId, patch });
  },
}));

mock.module("@/lib/sandbox/lifecycle", () => ({
  buildHibernatedLifecycleUpdate: () => ({ lifecycleState: "hibernated" }),
}));

mock.module("@/lib/sandbox/utils", () => ({
  clearSandboxState: () => null,
  clearUnavailableSandboxState: () => null,
  hasRuntimeSandboxState: (state: TestSandboxState | null) =>
    Boolean(state?.sandboxId),
  isSandboxUnavailableError: (message: string) =>
    message.toLowerCase().includes("sandbox unavailable"),
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

describe("/api/sessions/[sessionId]/files/content", () => {
  beforeEach(() => {
    connectCalls.length = 0;
    statCalls.length = 0;
    readFileCalls.length = 0;
    updateCalls.length = 0;
    connectSandboxError = null;
    authResult = { ok: true, userId: "user-1" };
    ownedSessionResult = {
      ok: true,
      sessionRecord: {
        id: "session-1",
        userId: "user-1",
        sandboxState: {
          type: "vercel",
          sandboxId: "sbx-1",
        },
      },
    };
    statImplementation = async () => ({
      isDirectory: () => false,
      isFile: () => true,
      size: 42,
    });
    readFileImplementation = async () => "export const answer = 42;\n";
  });

  test("returns auth failures from the session guard", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await loadRouteModule();

    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/files/content?path=apps/web/lib/test.ts",
      ),
      createContext(),
    );

    expect(response.status).toBe(401);
    expect(connectCalls).toHaveLength(0);
  });

  test("rejects invalid or traversing paths before connecting to the sandbox", async () => {
    const { GET } = await loadRouteModule();

    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/files/content?path=../secrets.txt",
      ),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid file path");
    expect(connectCalls).toHaveLength(0);
    expect(statCalls).toHaveLength(0);
  });

  test("returns a normalized file preview for valid workspace files", async () => {
    const { GET } = await loadRouteModule();

    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/files/content?path=apps%5Cweb%5Clib%5Ctest%20file.ts",
      ),
      createContext(),
    );
    const body = (await response.json()) as {
      path: string;
      content: string;
      size: number;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      path: "apps/web/lib/test file.ts",
      content: "export const answer = 42;\n",
      size: 42,
    });
    expect(connectCalls).toEqual([
      {
        type: "vercel",
        sandboxId: "sbx-1",
      },
    ]);
    expect(statCalls).toEqual(["/workspace/apps/web/lib/test file.ts"]);
    expect(readFileCalls).toEqual([
      {
        path: "/workspace/apps/web/lib/test file.ts",
        encoding: "utf-8",
      },
    ]);
  });

  test("rejects directories instead of trying to read them", async () => {
    statImplementation = async () => ({
      isDirectory: () => true,
      isFile: () => false,
      size: 0,
    });
    const { GET } = await loadRouteModule();

    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/files/content?path=apps/web/components",
      ),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Directories cannot be previewed");
    expect(readFileCalls).toHaveLength(0);
  });

  test("returns not found when the file is missing", async () => {
    statImplementation = async () => {
      throw new Error(
        "ENOENT: no such file or directory, stat '/workspace/missing.ts'",
      );
    };
    const { GET } = await loadRouteModule();

    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/files/content?path=apps/web/lib/missing.ts",
      ),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe("File not found");
    expect(readFileCalls).toHaveLength(0);
  });

  test("marks the session hibernated when the sandbox is unavailable", async () => {
    connectSandboxError = new Error("sandbox unavailable: connection closed");
    const { GET } = await loadRouteModule();

    const response = await GET(
      new Request(
        "http://localhost/api/sessions/session-1/files/content?path=apps/web/lib/test.ts",
      ),
      createContext(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toBe("Sandbox is unavailable. Please resume sandbox.");
    expect(updateCalls).toEqual([
      {
        sessionId: "session-1",
        patch: {
          sandboxState: null,
          lifecycleState: "hibernated",
        },
      },
    ]);
  });
});
