import type { HarnessAgentSettings } from "@ai-sdk/harness/agent";

type HarnessSandboxSession = Parameters<
  NonNullable<HarnessAgentSettings["onSandboxSession"]>
>[0]["session"];

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function linkHarnessWorkingDirectory(options: {
  session: HarnessSandboxSession;
  sessionWorkDir: string;
  workingDirectory: string;
  abortSignal?: AbortSignal;
}): Promise<void> {
  if (options.sessionWorkDir === options.workingDirectory) {
    return;
  }

  const result = await options.session.run({
    command: [
      `rm -rf -- ${shellQuote(options.sessionWorkDir)}`,
      `ln -s -- ${shellQuote(options.workingDirectory)} ${shellQuote(options.sessionWorkDir)}`,
    ].join(" && "),
    abortSignal: options.abortSignal,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to link harness workspace: ${result.stderr || result.stdout}`,
    );
  }
}
