import "server-only";

import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { connectSandbox } from "@open-harness/sandbox";
import type { getSessionById } from "@/lib/db/sessions";
import {
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_WORKING_DIRECTORY,
  TERMINAL_SANDBOX_PORT,
} from "../config";
import {
  TERMINAL_SERVER_SCRIPT,
  TERMINAL_SERVER_VERSION,
} from "./server-script";

const TERMINAL_RUNTIME_DIR = "/tmp/open-harness-terminal";
const TERMINAL_PACKAGE_JSON_PATH = `${TERMINAL_RUNTIME_DIR}/package.json`;
const TERMINAL_SERVER_PATH = `${TERMINAL_RUNTIME_DIR}/server.mjs`;
const TERMINAL_TOKEN_PATH = `${TERMINAL_RUNTIME_DIR}/token`;
const TERMINAL_LOG_PATH = `${TERMINAL_RUNTIME_DIR}/server.log`;
const TERMINAL_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const TERMINAL_START_ATTEMPTS = 30;
const TERMINAL_START_INTERVAL_MS = 1_000;

const TERMINAL_PACKAGE_JSON = JSON.stringify(
  {
    private: true,
    type: "module",
    dependencies: {
      "@lydell/node-pty": "1.0.1",
      "ghostty-web": "0.3.0",
      ws: "8.18.0",
    },
  },
  null,
  2,
);

type SessionTerminalRecord = NonNullable<
  Awaited<ReturnType<typeof getSessionById>>
>;

export type SessionTerminalLaunchResult =
  | {
      status: "ready";
      terminalUrl: string;
    }
  | {
      status: "requires_restart";
      message: string;
    };

function buildRequiresRestartResult(): SessionTerminalLaunchResult {
  return {
    status: "requires_restart",
    message:
      "This sandbox was created before terminal routing was enabled. Restart the sandbox once to open a terminal.",
  };
}

async function hasInstalledTerminalDependencies(
  sandbox: Awaited<ReturnType<typeof connectSandbox>>,
): Promise<boolean> {
  try {
    await Promise.all([
      sandbox.access(`${TERMINAL_RUNTIME_DIR}/node_modules/ghostty-web`),
      sandbox.access(`${TERMINAL_RUNTIME_DIR}/node_modules/ws`),
      sandbox.access(`${TERMINAL_RUNTIME_DIR}/node_modules/@lydell/node-pty`),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function ensureTerminalRuntimeFiles(
  sandbox: Awaited<ReturnType<typeof connectSandbox>>,
): Promise<void> {
  await sandbox.mkdir(TERMINAL_RUNTIME_DIR, { recursive: true });
  await Promise.all([
    sandbox.writeFile(
      TERMINAL_PACKAGE_JSON_PATH,
      TERMINAL_PACKAGE_JSON,
      "utf-8",
    ),
    sandbox.writeFile(TERMINAL_SERVER_PATH, TERMINAL_SERVER_SCRIPT, "utf-8"),
  ]);
}

function getCommandError(result: {
  stderr: string;
  stdout: string;
  exitCode: number | null;
}): string {
  const details = result.stderr.trim() || result.stdout.trim();
  if (details) {
    return details;
  }
  return result.exitCode === null
    ? "command failed"
    : `command failed with exit code ${result.exitCode}`;
}

async function ensureTerminalDependencies(
  sandbox: Awaited<ReturnType<typeof connectSandbox>>,
): Promise<void> {
  if (await hasInstalledTerminalDependencies(sandbox)) {
    return;
  }

  const installResult = await sandbox.exec(
    "npm install --omit=dev --no-audit --no-fund",
    TERMINAL_RUNTIME_DIR,
    TERMINAL_INSTALL_TIMEOUT_MS,
  );

  if (!installResult.success) {
    throw new Error(
      `Failed to install terminal runtime dependencies: ${getCommandError(installResult)}`,
    );
  }
}

function buildHealthUrl(terminalBaseUrl: string): string {
  return new URL("/health", terminalBaseUrl).toString();
}

type TerminalHealthStatus = {
  ok: boolean;
  version: string | null;
};

async function getTerminalHealthStatus(
  terminalBaseUrl: string,
): Promise<TerminalHealthStatus> {
  try {
    const response = await fetch(buildHealthUrl(terminalBaseUrl), {
      cache: "no-store",
    });
    if (!response.ok) {
      return { ok: false, version: null };
    }

    try {
      const body = (await response.json()) as { version?: unknown };
      return {
        ok: true,
        version: typeof body.version === "string" ? body.version : null,
      };
    } catch {
      return { ok: true, version: null };
    }
  } catch {
    return { ok: false, version: null };
  }
}

function hasExpectedTerminalVersion(status: TerminalHealthStatus): boolean {
  return status.ok && status.version === TERMINAL_SERVER_VERSION;
}

async function waitForTerminalHealthcheck(
  terminalBaseUrl: string,
  attempts: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await getTerminalHealthStatus(terminalBaseUrl);
    if (hasExpectedTerminalVersion(status)) {
      return true;
    }

    if (attempt < attempts - 1) {
      await sleep(TERMINAL_START_INTERVAL_MS);
    }
  }

  return false;
}

async function stopTerminalServer(
  sandbox: Awaited<ReturnType<typeof connectSandbox>>,
): Promise<void> {
  const stopResult = await sandbox.exec(
    `pkill -f "${TERMINAL_SERVER_PATH}" || true`,
    DEFAULT_WORKING_DIRECTORY,
    15_000,
  );

  if (!stopResult.success) {
    throw new Error(
      `Failed to stop the terminal server: ${getCommandError(stopResult)}`,
    );
  }
}

async function startTerminalServer(
  sandbox: Awaited<ReturnType<typeof connectSandbox>>,
  terminalBaseUrl: string,
): Promise<void> {
  if (!sandbox.execDetached) {
    throw new Error("Detached execution is not supported by this sandbox");
  }

  await sandbox.execDetached(
    `node server.mjs > "${TERMINAL_LOG_PATH}" 2>&1`,
    TERMINAL_RUNTIME_DIR,
  );

  const isHealthy = await waitForTerminalHealthcheck(
    terminalBaseUrl,
    TERMINAL_START_ATTEMPTS,
  );

  if (!isHealthy) {
    throw new Error(
      `Timed out waiting for the terminal server on port ${TERMINAL_SANDBOX_PORT}`,
    );
  }
}

function buildTerminalUrl(terminalBaseUrl: string, token: string): string {
  const url = new URL(terminalBaseUrl);
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

export async function bootstrapSessionTerminal(
  sessionRecord: SessionTerminalRecord,
): Promise<SessionTerminalLaunchResult> {
  if (!sessionRecord.sandboxState) {
    throw new Error("Sandbox not initialized");
  }

  const sandbox = await connectSandbox(sessionRecord.sandboxState, {
    env: {
      OPEN_HARNESS_TERMINAL_CWD: DEFAULT_WORKING_DIRECTORY,
      OPEN_HARNESS_TERMINAL_PORT: String(TERMINAL_SANDBOX_PORT),
      OPEN_HARNESS_TERMINAL_TOKEN_FILE: TERMINAL_TOKEN_PATH,
    },
    ports: DEFAULT_SANDBOX_PORTS,
  });

  if (typeof sandbox.domain !== "function") {
    return buildRequiresRestartResult();
  }

  let terminalBaseUrl: string;
  try {
    terminalBaseUrl = sandbox.domain(TERMINAL_SANDBOX_PORT);
  } catch {
    return buildRequiresRestartResult();
  }

  await ensureTerminalRuntimeFiles(sandbox);

  const launchToken = randomUUID();
  await sandbox.writeFile(TERMINAL_TOKEN_PATH, launchToken, "utf-8");

  const currentHealth = await getTerminalHealthStatus(terminalBaseUrl);
  if (!hasExpectedTerminalVersion(currentHealth)) {
    await ensureTerminalDependencies(sandbox);
    await stopTerminalServer(sandbox);
    await startTerminalServer(sandbox, terminalBaseUrl);
  }

  return {
    status: "ready",
    terminalUrl: buildTerminalUrl(terminalBaseUrl, launchToken),
  };
}
