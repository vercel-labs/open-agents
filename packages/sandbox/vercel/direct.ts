import { APIClient } from "@vercel/sandbox/dist/api-client";
import { getCredentials } from "@vercel/sandbox/dist/utils/get-credentials";
import type { Dirent } from "fs";
import { buffer as streamToBuffer } from "node:stream/consumers";
import type { ExecResult, Sandbox, SandboxStats } from "../interface";
import type { VercelState } from "./state";

const DEFAULT_WORKING_DIRECTORY = "/vercel/sandbox";
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_LENGTH = 50_000;
const DETACHED_QUICK_FAILURE_WINDOW_MS = 2_000;

let sharedApiClientPromise: Promise<APIClient | null> | null = null;

function isDirectSandboxConnectionDisabled(): boolean {
  return process.env.OPEN_HARNESS_SANDBOX_REST === "0";
}

async function getSharedApiClient(): Promise<APIClient | null> {
  if (isDirectSandboxConnectionDisabled()) {
    return null;
  }

  if (!sharedApiClientPromise) {
    sharedApiClientPromise = (async () => {
      try {
        const credentials = await getCredentials();
        return new APIClient({
          teamId: credentials.teamId,
          token: credentials.token,
        });
      } catch {
        return null;
      }
    })();
  }

  return sharedApiClientPromise;
}

function isAbortLikeError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

interface CommandLogs {
  stdout: string;
  stderr: string;
  combined: string;
}

interface FinishedCommandResult {
  exitCode: number;
  logs: CommandLogs;
}

class VercelDirectSandbox implements Sandbox {
  readonly type = "cloud" as const;
  readonly currentBranch = undefined;
  readonly hooks = undefined;
  readonly environmentDetails = undefined;
  readonly host = undefined;
  readonly expiresAt = undefined;
  readonly timeout = undefined;

  readonly workingDirectory: string;
  readonly env?: Record<string, string>;

  private readonly client: APIClient;
  private readonly sandboxId: string;

  constructor(params: {
    client: APIClient;
    sandboxId: string;
    workingDirectory: string;
    env?: Record<string, string>;
  }) {
    this.client = params.client;
    this.sandboxId = params.sandboxId;
    this.workingDirectory = params.workingDirectory;
    this.env = params.env;
  }

  private async collectLogs(
    commandId: string,
    signal?: AbortSignal,
  ): Promise<CommandLogs> {
    let stdout = "";
    let stderr = "";
    let combined = "";

    for await (const chunk of this.client.getLogs({
      sandboxId: this.sandboxId,
      cmdId: commandId,
      signal,
    })) {
      combined += chunk.data;
      if (chunk.stream === "stdout") {
        stdout += chunk.data;
      } else {
        stderr += chunk.data;
      }
    }

    return { stdout, stderr, combined };
  }

  private async runCommandAndWait(params: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    sudo?: boolean;
    signal?: AbortSignal;
  }): Promise<FinishedCommandResult> {
    const commandStream = await this.client.runCommand({
      sandboxId: this.sandboxId,
      command: params.command,
      args: params.args ?? [],
      cwd: params.cwd,
      env: params.env ?? this.env ?? {},
      sudo: params.sudo ?? false,
      wait: true,
      signal: params.signal,
    });

    const logsPromise = this.collectLogs(commandStream.command.id, params.signal);
    const finishedCommand = await commandStream.finished;
    const logs = await logsPromise;

    return {
      exitCode: finishedCommand.exitCode ?? 0,
      logs,
    };
  }

  async readFile(path: string, _encoding: "utf-8"): Promise<string> {
    const stream = await this.client.readFile({
      sandboxId: this.sandboxId,
      path,
    });

    if (stream === null) {
      throw new Error(`Failed to read file: ${path}`);
    }

    const fileBuffer = await streamToBuffer(stream);
    return fileBuffer.toString("utf-8");
  }

  async writeFile(path: string, content: string, _encoding: "utf-8"): Promise<void> {
    await this.client.writeFiles({
      sandboxId: this.sandboxId,
      cwd: this.workingDirectory,
      extractDir: "/",
      files: [{ path, content: Buffer.from(content, "utf-8") }],
    });
  }

  async stat(path: string): Promise<SandboxStats> {
    const result = await this.runCommandAndWait({
      command: "stat",
      args: ["-c", "%F\t%s\t%Y", path],
      cwd: this.workingDirectory,
      signal: AbortSignal.timeout(DEFAULT_COMMAND_TIMEOUT_MS),
    });

    if (result.exitCode !== 0) {
      throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
    }

    const output = result.logs.combined.trim();
    const [fileType, sizeStr, mtimeStr] = output.split("\t");

    const isDir = fileType === "directory";
    const size = Number.parseInt(sizeStr ?? "0", 10);
    const mtimeMs = Number.parseInt(mtimeStr ?? "0", 10) * 1000;

    return {
      isDirectory: () => isDir,
      isFile: () => !isDir,
      size,
      mtimeMs,
    };
  }

  async access(path: string): Promise<void> {
    const result = await this.runCommandAndWait({
      command: "test",
      args: ["-e", path],
      cwd: this.workingDirectory,
      signal: AbortSignal.timeout(DEFAULT_COMMAND_TIMEOUT_MS),
    });

    if (result.exitCode !== 0) {
      throw new Error(`ENOENT: no such file or directory, access '${path}'`);
    }
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const args = options?.recursive ? ["-p", path] : [path];
    const result = await this.runCommandAndWait({
      command: "mkdir",
      args,
      cwd: this.workingDirectory,
      signal: AbortSignal.timeout(DEFAULT_COMMAND_TIMEOUT_MS),
    });

    if (result.exitCode !== 0) {
      const errorOutput = result.logs.combined;
      if (!errorOutput.includes("File exists") || !options?.recursive) {
        throw new Error(`Failed to create directory: ${path}`);
      }
    }
  }

  async readdir(path: string, _options: { withFileTypes: true }): Promise<Dirent[]> {
    const result = await this.runCommandAndWait({
      command: "find",
      args: [path, "-maxdepth", "1", "-mindepth", "1", "-printf", "%y %f\\n"],
      cwd: this.workingDirectory,
      signal: AbortSignal.timeout(DEFAULT_COMMAND_TIMEOUT_MS),
    });

    if (result.exitCode !== 0) {
      throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
    }

    const output = result.logs.combined.trim();
    if (!output) {
      return [];
    }

    return output.split("\n").map((line) => {
      const [type, ...nameParts] = line.split(" ");
      const name = nameParts.join(" ");
      const isDir = type === "d";
      const isFile = type === "f";
      const isSymlink = type === "l";

      return {
        name,
        parentPath: path,
        path,
        isDirectory: () => isDir,
        isFile: () => isFile,
        isSymbolicLink: () => isSymlink,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isFIFO: () => false,
        isSocket: () => false,
      } as Dirent;
    });
  }

  async exec(command: string, cwd: string, timeoutMs: number): Promise<ExecResult> {
    const signal = AbortSignal.timeout(timeoutMs);

    try {
      const result = await this.runCommandAndWait({
        command: "bash",
        args: ["-c", command],
        cwd,
        signal,
      });

      let stdout = result.logs.combined;
      let truncated = false;

      if (stdout.length > MAX_OUTPUT_LENGTH) {
        stdout = stdout.slice(0, MAX_OUTPUT_LENGTH);
        truncated = true;
      }

      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout,
        stderr: "",
        truncated,
      };
    } catch (error) {
      if (isAbortLikeError(error)) {
        return {
          success: false,
          exitCode: null,
          stdout: "",
          stderr: `Command timed out after ${timeoutMs}ms`,
          truncated: false,
        };
      }

      return {
        success: false,
        exitCode: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        truncated: false,
      };
    }
  }

  async execDetached(command: string, cwd: string): Promise<{ commandId: string }> {
    const commandResponse = await this.client.runCommand({
      sandboxId: this.sandboxId,
      command: "bash",
      args: ["-c", command],
      cwd,
      env: this.env ?? {},
      sudo: false,
    });

    const commandId = commandResponse.json.command.id;
    const quickProbeSignal = AbortSignal.timeout(
      DETACHED_QUICK_FAILURE_WINDOW_MS,
    );

    try {
      const finished = await this.client.getCommand({
        sandboxId: this.sandboxId,
        cmdId: commandId,
        wait: true,
        signal: quickProbeSignal,
      });

      const exitCode = finished.json.command.exitCode;
      if (exitCode !== 0) {
        const logs = await this.collectLogs(commandId);
        const trimmedStderr = logs.stderr.trim();
        const stderrSnippet = (
          trimmedStderr || logs.combined.trim() || "<no stderr>"
        ).slice(0, MAX_OUTPUT_LENGTH);

        throw new Error(
          `Background command exited with code ${exitCode}. stderr:\n${stderrSnippet}`,
        );
      }
    } catch (error) {
      if (isAbortLikeError(error)) {
        return { commandId };
      }
      throw error;
    }

    return { commandId };
  }

  async stop(): Promise<void> {
    await this.client.stopSandbox({ sandboxId: this.sandboxId });
  }

  getState(): { type: "vercel" } & VercelState {
    return {
      type: "vercel",
      sandboxId: this.sandboxId,
    };
  }
}

interface DirectConnectOptions {
  sandboxId: string;
  workingDirectory?: string;
  env?: Record<string, string>;
}

/**
 * Attempt to create a direct sandbox adapter backed by the Vercel REST API.
 *
 * This skips the initial sandbox reconnect handshake and assumes the sandbox
 * is already running. Returns null when credentials are not available so
 * callers can fall back to standard connect logic.
 */
export async function tryConnectVercelSandboxDirect(
  options: DirectConnectOptions,
): Promise<Sandbox | null> {
  const client = await getSharedApiClient();
  if (!client) {
    return null;
  }

  return new VercelDirectSandbox({
    client,
    sandboxId: options.sandboxId,
    workingDirectory: options.workingDirectory ?? DEFAULT_WORKING_DIRECTORY,
    env: options.env,
  });
}
