import { connectSandbox } from "@open-harness/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSessionWithSandboxGuard,
} from "@/app/api/sessions/_lib/session-context";
import {
  isManagedTemplateTrialUser,
  MANAGED_TEMPLATE_TRIAL_CODE_EDITOR_ERROR,
} from "@/lib/managed-template-trial";
import { CODE_SERVER_PORT, DEFAULT_SANDBOX_PORTS } from "@/lib/sandbox/config";
import { getServerSession } from "@/lib/session/get-server-session";
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

export async function GET(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;

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

    return Response.json({
      running,
      url: running && sandbox.domain ? sandbox.domain(port) : null,
      port,
    } satisfies CodeEditorStatusResponse);
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

  const session = await getServerSession();
  if (isManagedTemplateTrialUser(session, req.url)) {
    return Response.json(
      { error: MANAGED_TEMPLATE_TRIAL_CODE_EDITOR_ERROR },
      { status: 403 },
    );
  }

  const { sessionId } = await context.params;

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

    // Reuse an existing code-server process when we can positively identify it.
    if (await isCodeServerRunning(sandbox)) {
      return Response.json({
        url: sandbox.domain(port),
        port,
      } satisfies CodeEditorLaunchResponse);
    }

    if (await isPortInUse(sandbox, port)) {
      return Response.json(
        { error: `Port ${port} is already in use by another process` },
        { status: 409 },
      );
    }

    // Launch code-server in detached mode
    const launchCommand = [
      `printf '%s' "$$" > ${shellQuote(CODE_SERVER_PIDFILE)}`,
      `exec code-server --port ${port} --auth none --bind-addr 0.0.0.0:${port} --disable-telemetry ${shellQuote(workingDirectory)}`,
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

    return Response.json({
      url: sandbox.domain(port),
      port,
    } satisfies CodeEditorLaunchResponse);
  } catch (error) {
    console.error("Failed to launch code editor:", error);
    return Response.json(
      { error: "Failed to launch code editor" },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;

  try {
    const sandboxResult = await connectCodeEditorSandbox(
      sessionId,
      authResult.userId,
    );
    if (!sandboxResult.ok) {
      return sandboxResult.response;
    }

    const stopped = await stopCodeServer(sandboxResult.sandbox);

    return Response.json({ stopped } satisfies CodeEditorStopResponse);
  } catch (error) {
    console.error("Failed to stop code editor:", error);
    return Response.json(
      { error: "Failed to stop code editor" },
      { status: 500 },
    );
  }
}
