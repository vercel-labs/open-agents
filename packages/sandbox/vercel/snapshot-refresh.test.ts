import { describe, expect, mock, test } from "bun:test";
import type { SandboxConnectConfig } from "../factory";
import type { ExecResult } from "../interface";
import {
  DEFAULT_BASE_SNAPSHOT_COMMAND_TIMEOUT_MS,
  refreshBaseSnapshot,
} from "./snapshot-refresh";

interface MockSnapshotSandbox {
  workingDirectory: string;
  exec: (
    command: string,
    cwd: string,
    timeoutMs: number,
  ) => Promise<ExecResult>;
  stop: () => Promise<void>;
  snapshot?: () => Promise<{ snapshotId: string }>;
}

function createExecResult(overrides: Partial<ExecResult> = {}): ExecResult {
  return {
    success: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
    truncated: false,
    ...overrides,
  };
}

function createSandbox(
  overrides: Partial<MockSnapshotSandbox> = {},
): MockSnapshotSandbox {
  return {
    workingDirectory: "/vercel/sandbox",
    exec: async () => createExecResult(),
    stop: async () => {},
    snapshot: async () => ({ snapshotId: "snap-next" }),
    ...overrides,
  };
}

describe("refreshBaseSnapshot", () => {
  test("creates a new snapshot from the configured base snapshot", async () => {
    const connectCalls: SandboxConnectConfig[] = [];
    const execCalls: Array<{
      command: string;
      cwd: string;
      timeoutMs: number;
    }> = [];
    const logs: string[] = [];
    const stop = mock(async () => {});
    const snapshot = mock(async () => ({ snapshotId: "snap-next" }));

    const result = await refreshBaseSnapshot(
      {
        baseSnapshotId: "snap-current",
        sandboxTimeoutMs: 300_000,
        ports: [3000, 5173],
        commands: ["bun --version", "jq --version"],
        log: (message) => logs.push(message),
      },
      {
        connectSandbox: async (config) => {
          connectCalls.push(config);

          return createSandbox({
            stop,
            snapshot,
            exec: async (command, cwd, timeoutMs) => {
              execCalls.push({ command, cwd, timeoutMs });
              return createExecResult({ stdout: `ran ${command}` });
            },
          });
        },
      },
    );

    expect(connectCalls).toEqual([
      {
        state: { type: "vercel" },
        options: {
          baseSnapshotId: "snap-current",
          timeout: 300_000,
          persistent: false,
          skipGitWorkspaceBootstrap: true,
          ports: [3000, 5173],
        },
      },
    ]);
    expect(execCalls).toEqual([
      {
        command: "bun --version",
        cwd: "/vercel/sandbox",
        timeoutMs: DEFAULT_BASE_SNAPSHOT_COMMAND_TIMEOUT_MS,
      },
      {
        command: "jq --version",
        cwd: "/vercel/sandbox",
        timeoutMs: DEFAULT_BASE_SNAPSHOT_COMMAND_TIMEOUT_MS,
      },
    ]);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(result).toEqual({
      sourceSnapshotId: "snap-current",
      snapshotId: "snap-next",
      commandResults: [
        {
          command: "bun --version",
          exitCode: 0,
          stdout: "ran bun --version",
          stderr: "",
          truncated: false,
        },
        {
          command: "jq --version",
          exitCode: 0,
          stdout: "ran jq --version",
          stderr: "",
          truncated: false,
        },
      ],
    });
    expect(logs).toEqual([
      "Creating sandbox from base snapshot snap-current.",
      "Running command 1/2: bun --version",
      "Running command 2/2: jq --version",
      "Creating snapshot from prepared sandbox.",
      "Created snapshot snap-next.",
    ]);
  });

  test("stops the sandbox and surfaces command output when setup fails", async () => {
    const stop = mock(async () => {});
    const snapshot = mock(async () => ({ snapshotId: "snap-next" }));

    const refreshPromise = refreshBaseSnapshot(
      {
        baseSnapshotId: "snap-current",
        sandboxTimeoutMs: 300_000,
        commands: ["bun install"],
      },
      {
        connectSandbox: async () =>
          createSandbox({
            stop,
            snapshot,
            exec: async () =>
              createExecResult({
                success: false,
                exitCode: 1,
                stdout: "install output",
                stderr: "install error",
              }),
          }),
      },
    );

    await expect(refreshPromise).rejects.toThrow(
      "Command failed while preparing base snapshot: bun install",
    );
    await expect(refreshPromise).rejects.toThrow("stdout:\ninstall output");
    await expect(refreshPromise).rejects.toThrow("stderr:\ninstall error");
    expect(snapshot).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  test("stops the sandbox when snapshot support is unavailable", async () => {
    const stop = mock(async () => {});

    const refreshPromise = refreshBaseSnapshot(
      {
        baseSnapshotId: "snap-current",
        sandboxTimeoutMs: 300_000,
      },
      {
        connectSandbox: async () =>
          createSandbox({
            stop,
            snapshot: undefined,
          }),
      },
    );

    await expect(refreshPromise).rejects.toThrow(
      "Configured sandbox provider does not support snapshots.",
    );
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
