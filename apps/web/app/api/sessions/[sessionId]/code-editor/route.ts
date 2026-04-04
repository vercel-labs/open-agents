import { connectSandbox } from "@open-harness/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSessionWithSandboxGuard,
} from "@/app/api/sessions/_lib/session-context";
import {
  CODE_SERVER_PORT,
  CODESPACE_PROXY_BASE_PATH,
  CODESPACE_TARGETS_COOKIE,
  DEFAULT_SANDBOX_PORTS,
} from "@/lib/sandbox/config";
import { isSandboxActive } from "@/lib/sandbox/utils";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export type CodeEditorLaunchResponse = {
  url: string;
  port: number;
};

export type CodeEditorStatusResponse = {
  running: boolean;
  url: string | null;
  port: number;
};

export type CodeEditorStopResponse = {
  stopped: boolean;
};

const CODE_SERVER_PIDFILE = "/tmp/open-harness-code-server.pid";

type ConnectedSandbox = Awaited<ReturnType<typeof connectSandbox>>;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

// ---------------------------------------------------------------------------
// Codespace targets cookie helpers
//
// We read/write via raw Cookie / Set-Cookie headers rather than the
// next/headers cookies() API so that the route stays testable outside
// a full Next.js request scope.
// ---------------------------------------------------------------------------

type CodespaceTargets = Record<string, string>;

function parseTargetsCookie(cookieHeader: string | null): CodespaceTargets {
  if (!cookieHeader) return {};
  try {
    for (const part of cookieHeader.split(";")) {
      const [key, ...rest] = part.split("=");
      if (key.trim() === CODESPACE_TARGETS_COOKIE) {
        return JSON.parse(
          decodeURIComponent(rest.join("=").trim()),
        ) as CodespaceTargets;
      }
    }
  } catch {
    // Malformed cookie — start fresh
  }
  return {};
}

function buildTargetsSetCookie(targets: CodespaceTargets): string {
  const value = encodeURIComponent(JSON.stringify(targets));
  const isSecure = process.env.NODE_ENV === "production";
  return [
    `${CODESPACE_TARGETS_COOKIE}=${value}`,
    "HttpOnly",
    isSecure ? "Secure" : "",
    "SameSite=Strict",
    `Path=${CODESPACE_PROXY_BASE_PATH}`,
    "Max-Age=86400",
  ]
    .filter(Boolean)
    .join("; ");
}

/** Clone a Response and append a Set-Cookie that upserts a target entry. */
function withTargetEntry(
  response: Response,
  cookieHeader: string | null,
  sessionId: string,
  sandboxUrl: string,
): Response {
  const targets = parseTargetsCookie(cookieHeader);
  targets[sessionId] = sandboxUrl;
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", buildTargetsSetCookie(targets));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Clone a Response and append a Set-Cookie that removes a target entry. */
function withoutTargetEntry(
  response: Response,
  cookieHeader: string | null,
  sessionId: string,
): Response {
  const targets = parseTargetsCookie(cookieHeader);
  delete targets[sessionId];
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", buildTargetsSetCookie(targets));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ---------------------------------------------------------------------------
// Sandbox helpers
// ---------------------------------------------------------------------------

async function connectCodeEditorSandbox(sessionId: string, userId: string) {
  const sessionContext = await requireOwnedSessionWithSandboxGuard({
    userId,
    sessionId,
    sandboxGuard: isSandboxActive,
    sandboxErrorMessage: "Resume the sandbox before opening the editor",
    sandboxErrorStatus: 409,
  });
  if (!sessionContext.ok) {
    return sessionContext;
  }

  const sandboxState = sessionContext.sessionRecord.sandboxState;
  if (!sandboxState) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Resume the sandbox before opening the editor" },
        { status: 409 },
      ),
    };
  }

  const sandbox = await connectSandbox(sandboxState, {
    ports: DEFAULT_SANDBOX_PORTS,
  });

  return {
    ok: true as const,
    sandbox,
  };
}

async function getRunningCodeServerPid(
  sandbox: ConnectedSandbox,
): Promise<string | null> {
  try {
    const pid = (await sandbox.readFile(CODE_SERVER_PIDFILE, "utf-8")).trim();
    if (!/^[1-9][0-9]*$/.test(pid)) {
      await sandbox.exec(
        `rm -f ${shellQuote(CODE_SERVER_PIDFILE)}`,
        "/tmp",
        5_000,
      );
      return null;
    }

    const checkResult = await sandbox.exec(`kill -0 ${pid}`, "/tmp", 5_000);
    if (!checkResult.success) {
      await sandbox.exec(
        `rm -f ${shellQuote(CODE_SERVER_PIDFILE)}`,
        "/tmp",
        5_000,
      );
      return null;
    }

    return pid;
  } catch {
    return null;
  }
}

function isCodeServerProcessCommand(command: string): boolean {
  return (
    command.includes("code-server") &&
    (command.includes(`--port ${CODE_SERVER_PORT}`) ||
      command.includes(`--bind-addr 0.0.0.0:${CODE_SERVER_PORT}`))
  );
}

async function findCodeServerPidFromProcessList(
  sandbox: ConnectedSandbox,
): Promise<string | null> {
  try {
    const processListResult = await sandbox.exec(
      "ps -eo pid=,args=",
      "/tmp",
      5_000,
    );
    if (!processListResult.success) {
      return null;
    }

    for (const line of processListResult.stdout.split("\n")) {
      const match = line.trim().match(/^([1-9][0-9]*)\s+(.*)$/);
      if (!match) {
        continue;
      }

      const [, pid, command] = match;
      if (!isCodeServerProcessCommand(command)) {
        continue;
      }

      const checkResult = await sandbox.exec(`kill -0 ${pid}`, "/tmp", 5_000);
      if (checkResult.success) {
        return pid;
      }
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Check if something is listening on the code-server port by attempting
 * a connection. Uses curl which is universally available in the sandbox
 * (ss/fuser/lsof are not installed).
 */
async function isPortInUse(
  sandbox: ConnectedSandbox,
  port: number,
): Promise<boolean> {
  const result = await sandbox.exec(
    `curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:${port}/healthz 2>/dev/null || curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:${port}/ 2>/dev/null`,
    "/tmp",
    10_000,
  );
  // Any HTTP response (even 302/404) means something is listening
  const code = Number.parseInt(result.stdout.trim(), 10);
  return result.success && !Number.isNaN(code) && code > 0;
}

async function findRunningCodeServerPid(
  sandbox: ConnectedSandbox,
): Promise<string | null> {
  const pid = await getRunningCodeServerPid(sandbox);
  if (pid) {
    return pid;
  }

  return findCodeServerPidFromProcessList(sandbox);
}

/**
 * Check if code-server is running, using a tracked PID first and then
 * a process-list lookup for code-server specifically.
 */
async function isCodeServerRunning(
  sandbox: ConnectedSandbox,
): Promise<boolean> {
  const pid = await findRunningCodeServerPid(sandbox);
  return pid !== null;
}

async function stopCodeServer(sandbox: ConnectedSandbox): Promise<boolean> {
  const pid = await findRunningCodeServerPid(sandbox);
  if (!pid) {
    await sandbox
      .exec(`rm -f ${shellQuote(CODE_SERVER_PIDFILE)}`, "/tmp", 5_000)
      .catch(() => undefined);
    return false;
  }

  await sandbox.exec(`kill ${pid} 2>/dev/null || true`, "/tmp", 5_000);
  await sandbox.exec(`rm -f ${shellQuote(CODE_SERVER_PIDFILE)}`, "/tmp", 5_000);

  const checkResult = await sandbox.exec(`kill -0 ${pid}`, "/tmp", 5_000);
  return !checkResult.success;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export async function GET(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;
  const cookieHeader = req.headers.get("cookie");

  try {
    const sandboxResult = await connectCodeEditorSandbox(
      sessionId,
      authResult.userId,
    );
    if (!sandboxResult.ok) {
      return sandboxResult.response;
    }

    const { sandbox } = sandboxResult;
    const port = CODE_SERVER_PORT;
    const running = await isCodeServerRunning(sandbox);
    const sandboxUrl = running && sandbox.domain ? sandbox.domain(port) : null;

    const response = Response.json({
      running,
      url: sandboxUrl,
      port,
    } satisfies CodeEditorStatusResponse);

    return sandboxUrl
      ? withTargetEntry(response, cookieHeader, sessionId, sandboxUrl)
      : response;
  } catch (error) {
    console.error("Failed to check code editor status:", error);
    return Response.json(
      { error: "Failed to check code editor status" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;
  const cookieHeader = req.headers.get("cookie");

  try {
    const sandboxResult = await connectCodeEditorSandbox(
      sessionId,
      authResult.userId,
    );
    if (!sandboxResult.ok) {
      return sandboxResult.response;
    }

    const { sandbox } = sandboxResult;
    if (!sandbox.execDetached) {
      return Response.json(
        { error: "Sandbox does not support background commands" },
        { status: 500 },
      );
    }

    if (!sandbox.domain) {
      return Response.json(
        { error: "Sandbox does not expose preview URLs" },
        { status: 500 },
      );
    }

    const port = CODE_SERVER_PORT;
    const workingDirectory = sandbox.workingDirectory;
    const basePath = `${CODESPACE_PROXY_BASE_PATH}/${sessionId}`;

    // Reuse an existing code-server process when we can positively identify it.
    if (await isCodeServerRunning(sandbox)) {
      const sandboxUrl = sandbox.domain(port);
      return withTargetEntry(
        Response.json({
          url: sandboxUrl,
          port,
        } satisfies CodeEditorLaunchResponse),
        cookieHeader,
        sessionId,
        sandboxUrl,
      );
    }

    if (await isPortInUse(sandbox, port)) {
      return Response.json(
        { error: `Port ${port} is already in use by another process` },
        { status: 409 },
      );
    }

    // Launch code-server in detached mode
    const launchCommand = [
      `printf '%s' "$" > ${shellQuote(CODE_SERVER_PIDFILE)}`,
      `exec code-server --port ${port} --auth none --bind-addr 0.0.0.0:${port} --disable-telemetry --base-path ${shellQuote(basePath)} ${shellQuote(workingDirectory)}`,
    ].join(" && ");

    try {
      await sandbox.execDetached(launchCommand, workingDirectory);
    } catch (error) {
      await sandbox
        .exec(
          `rm -f ${shellQuote(CODE_SERVER_PIDFILE)}`,
          workingDirectory,
          5_000,
        )
        .catch(() => undefined);
      throw error;
    }

    const sandboxUrl = sandbox.domain(port);
    return withTargetEntry(
      Response.json({
        url: sandboxUrl,
        port,
      } satisfies CodeEditorLaunchResponse),
      cookieHeader,
      sessionId,
      sandboxUrl,
    );
  } catch (error) {
    console.error("Failed to launch code editor:", error);
    return Response.json(
      { error: "Failed to launch code editor" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;
  const cookieHeader = req.headers.get("cookie");

  try {
    const sandboxResult = await connectCodeEditorSandbox(
      sessionId,
      authResult.userId,
    );
    if (!sandboxResult.ok) {
      return sandboxResult.response;
    }

    const stopped = await stopCodeServer(sandboxResult.sandbox);

    return withoutTargetEntry(
      Response.json({ stopped } satisfies CodeEditorStopResponse),
      cookieHeader,
      sessionId,
    );
  } catch (error) {
    console.error("Failed to stop code editor:", error);
    return Response.json(
      { error: "Failed to stop code editor" },
      { status: 500 },
    );
  }
}
