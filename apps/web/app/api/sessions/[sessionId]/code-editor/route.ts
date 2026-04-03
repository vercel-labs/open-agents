import { connectSandbox } from "@open-harness/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSessionWithSandboxGuard,
} from "@/app/api/sessions/_lib/session-context";
import { CODE_SERVER_PORT, DEFAULT_SANDBOX_PORTS } from "@/lib/sandbox/config";
import { isSandboxActive } from "@/lib/sandbox/utils";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export type CodeEditorLaunchResponse = {
  url: string;
  port: number;
};

export type CodeEditorStopResponse = {
  stopped: boolean;
};

const CODE_SERVER_PIDFILE = "/tmp/open-harness-code-server.pid";

type ConnectedSandbox = Awaited<ReturnType<typeof connectSandbox>>;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'}`;
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

async function stopCodeServer(sandbox: ConnectedSandbox): Promise<boolean> {
  const pid = await getRunningCodeServerPid(sandbox);
  if (!pid) {
    return false;
  }

  await sandbox.exec(`kill ${pid} 2>/dev/null || true`, "/tmp", 5_000);
  await sandbox.exec(`rm -f ${shellQuote(CODE_SERVER_PIDFILE)}`, "/tmp", 5_000);
  return true;
}

export async function POST(_req: Request, context: RouteContext) {
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

    // Check if code-server is already running
    const existingPid = await getRunningCodeServerPid(sandbox);
    if (existingPid) {
      return Response.json({
        url: sandbox.domain(port),
        port,
      } satisfies CodeEditorLaunchResponse);
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
