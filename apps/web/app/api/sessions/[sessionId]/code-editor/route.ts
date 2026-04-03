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

const CODE_SERVER_PIDFILE = ".open-harness-code-server.pid";

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
  sandbox: Awaited<ReturnType<typeof connectSandbox>>,
  workingDirectory: string,
): Promise<string | null> {
  const pidFilePath = `${workingDirectory}/${CODE_SERVER_PIDFILE}`;

  try {
    const pid = (await sandbox.readFile(pidFilePath, "utf-8")).trim();
    if (!/^[1-9][0-9]*$/.test(pid)) {
      await sandbox.exec(
        `rm -f ${shellQuote(pidFilePath)}`,
        workingDirectory,
        5_000,
      );
      return null;
    }

    const checkResult = await sandbox.exec(
      `kill -0 ${pid}`,
      workingDirectory,
      5_000,
    );
    if (!checkResult.success) {
      await sandbox.exec(
        `rm -f ${shellQuote(pidFilePath)}`,
        workingDirectory,
        5_000,
      );
      return null;
    }

    return pid;
  } catch {
    return null;
  }
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
    const pidFilePath = `${workingDirectory}/${CODE_SERVER_PIDFILE}`;

    // Check if code-server is already running
    const existingPid = await getRunningCodeServerPid(
      sandbox,
      workingDirectory,
    );
    if (existingPid) {
      return Response.json({
        url: sandbox.domain(port),
        port,
      } satisfies CodeEditorLaunchResponse);
    }

    // Launch code-server in detached mode
    const launchCommand = [
      `printf '%s' "$$" > ${shellQuote(pidFilePath)}`,
      `exec code-server --port ${port} --auth none --bind-addr 0.0.0.0:${port} --disable-telemetry ${shellQuote(workingDirectory)}`,
    ].join(" && ");

    try {
      await sandbox.execDetached(launchCommand, workingDirectory);
    } catch (error) {
      await sandbox
        .exec(`rm -f ${shellQuote(pidFilePath)}`, workingDirectory, 5_000)
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
