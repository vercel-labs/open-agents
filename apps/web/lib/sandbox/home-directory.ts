import "server-only";

import type { Sandbox } from "@open-harness/sandbox";

const DEFAULT_HOME_DIRECTORY = "/root";
const HOME_RESOLUTION_TIMEOUT_MS = 5_000;

export function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export async function resolveSandboxHomeDirectory(
  sandbox: Sandbox,
): Promise<string> {
  const result = await sandbox.exec(
    'printf %s "$HOME"',
    sandbox.workingDirectory,
    HOME_RESOLUTION_TIMEOUT_MS,
  );
  const homeDirectory = result.success ? result.stdout.trim() : "";
  return homeDirectory || DEFAULT_HOME_DIRECTORY;
}
