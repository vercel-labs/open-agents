import type { ExecResult } from "../interface.ts";
import {
  defaultConnectSnapshotSandbox,
  resolveSnapshotLog,
  runSnapshotLifecycle,
  type SnapshotSandbox,
  type SnapshotSandboxConnector,
} from "./snapshot-lifecycle.ts";

export type { SnapshotSandbox } from "./snapshot-lifecycle.ts";

export const DEFAULT_BASE_SNAPSHOT_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

export interface RefreshBaseSnapshotOptions {
  baseSnapshotId: string;
  commands?: string[];
  sandboxTimeoutMs: number;
  commandTimeoutMs?: number;
  ports?: number[];
  env?: Record<string, string>;
  prepare?: (sandbox: SnapshotSandbox) => Promise<void>;
  log?: (message: string) => void;
}

export interface RefreshBaseSnapshotCommandResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export interface RefreshBaseSnapshotResult {
  sourceSnapshotId: string;
  snapshotId: string;
  commandResults: RefreshBaseSnapshotCommandResult[];
}

interface RefreshBaseSnapshotDependencies {
  connectSandbox?: SnapshotSandboxConnector;
}

function formatCommandOutput(label: string, output: string): string | null {
  const trimmedOutput = output.trim();
  if (!trimmedOutput) {
    return null;
  }

  return `${label}:\n${trimmedOutput}`;
}

function formatCommandFailure(command: string, result: ExecResult): string {
  const sections = [
    `Command failed while preparing base snapshot: ${command}`,
    result.exitCode === null ? null : `Exit code: ${result.exitCode}`,
    formatCommandOutput("stdout", result.stdout),
    formatCommandOutput("stderr", result.stderr),
    result.truncated ? "Output was truncated." : null,
  ].filter((section): section is string => section !== null);

  return sections.join("\n\n");
}

export async function refreshBaseSnapshot(
  options: RefreshBaseSnapshotOptions,
  dependencies: RefreshBaseSnapshotDependencies = {},
): Promise<RefreshBaseSnapshotResult> {
  const commands =
    options.commands?.filter((command) => command.trim().length > 0) ?? [];
  const commandTimeoutMs =
    options.commandTimeoutMs ?? DEFAULT_BASE_SNAPSHOT_COMMAND_TIMEOUT_MS;
  const log = resolveSnapshotLog(options.log);
  const connectSnapshotSandbox =
    dependencies.connectSandbox ?? defaultConnectSnapshotSandbox;

  const { snapshotId, prepared: commandResults } = await runSnapshotLifecycle({
    log,
    connect: () => {
      log(`Creating sandbox from base snapshot ${options.baseSnapshotId}.`);
      // Skip git init so the new base image does not ship `.git` in /vercel/sandbox
      // (would break `git clone … .` for agent sandboxes).
      return connectSnapshotSandbox({
        state: { type: "vercel" },
        options: {
          baseSnapshotId: options.baseSnapshotId,
          timeout: options.sandboxTimeoutMs,
          persistent: false,
          skipGitWorkspaceBootstrap: true,
          ...(options.ports !== undefined && { ports: options.ports }),
          ...(options.env !== undefined && { env: options.env }),
        },
      });
    },
    prepare: async (sandbox) => {
      const commandResults: RefreshBaseSnapshotCommandResult[] = [];

      for (const [index, command] of commands.entries()) {
        log(`Running command ${index + 1}/${commands.length}: ${command}`);

        const result = await sandbox.exec(
          command,
          sandbox.workingDirectory,
          commandTimeoutMs,
        );

        commandResults.push({
          command,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          truncated: result.truncated,
        });

        if (!result.success) {
          throw new Error(formatCommandFailure(command, result));
        }
      }

      if (options.prepare) {
        log("Preparing sandbox runtime profile.");
        await options.prepare(sandbox);
      }

      return commandResults;
    },
    creatingSnapshotMessage: "Creating snapshot from prepared sandbox.",
    stopFailureMessage: "Failed to stop sandbox after refresh attempt",
  });

  return {
    sourceSnapshotId: options.baseSnapshotId,
    snapshotId,
    commandResults,
  };
}
