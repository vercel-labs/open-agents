import type { APIClient } from "@vercel/sandbox/dist/api-client";
import type { Dirent } from "fs";
import { buffer as streamToBuffer } from "node:stream/consumers";
import type { ExecResult, SandboxStats } from "../interface";

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_LENGTH = 50_000;
const DETACHED_QUICK_FAILURE_WINDOW_MS = 2_000;

export function isAbortLikeError(error: unknown): boolean {
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

async function collectLogs(
  client: APIClient,
  sandboxId: string,
  commandId: string,
  signal?: AbortSignal,
): Promise<CommandLogs> {
  let stdout = "";
  let stderr = "";
  let combined = "";

  for await (const chunk of client.getLogs({
    sandboxId,
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

async function runCommandAndWait(params: {
  client: APIClient;
  sandboxId: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  sudo?: boolean;
}): Promise<FinishedCommandResult> {
  const commandStream = await params.client.runCommand({
    sandboxId: params.sandboxId,
    command: params.command,
    args: params.args ?? [],
    cwd: params.cwd,
    env: params.env ?? {},
    sudo: params.sudo ?? false,
    wait: true,
    signal: params.signal,
  });

  const logsPromise = collectLogs(
    params.client,
    params.sandboxId,
    commandStream.command.id,
    params.signal,
  );
  const finishedCommand = await commandStream.finished;
  const logs = await logsPromise;

  return {
    exitCode: finishedCommand.exitCode ?? 0,
    logs,
  };
}

export async function readFileDirect(
  client: APIClient,
  sandboxId: string,
  path: string,
): Promise<string> {
  const stream = await client.readFile({ sandboxId, path });
  if (stream === null) {
    throw new Error(`Failed to read file: ${path}`);
  }

  const fileBuffer = await streamToBuffer(stream);
  return fileBuffer.toString("utf-8");
}

export async function writeFileDirect(params: {
  client: APIClient;
  sandboxId: string;
  workingDirectory: string;
  path: string;
  content: string;
}): Promise<void> {
  // Ensure parent directory exists (matches VercelSandbox.writeFile behavior)
  const parentDir = params.path.substring(0, params.path.lastIndexOf("/"));
  if (parentDir) {
    await mkdirDirect({
      client: params.client,
      sandboxId: params.sandboxId,
      workingDirectory: params.workingDirectory,
      path: parentDir,
      options: { recursive: true },
    });
  }

  await params.client.writeFiles({
    sandboxId: params.sandboxId,
    cwd: params.workingDirectory,
    extractDir: "/",
    files: [
      { path: params.path, content: Buffer.from(params.content, "utf-8") },
    ],
  });
}

export async function statDirect(params: {
  client: APIClient;
  sandboxId: string;
  workingDirectory: string;
  env?: Record<string, string>;
  path: string;
}): Promise<SandboxStats> {
  const result = await runCommandAndWait({
    client: params.client,
    sandboxId: params.sandboxId,
    command: "stat",
    args: ["-c", "%F\t%s\t%Y", params.path],
    cwd: params.workingDirectory,
    env: params.env,
    signal: AbortSignal.timeout(DEFAULT_COMMAND_TIMEOUT_MS),
  });

  if (result.exitCode !== 0) {
    throw new Error(`ENOENT: no such file or directory, stat '${params.path}'`);
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

export async function accessDirect(params: {
  client: APIClient;
  sandboxId: string;
  workingDirectory: string;
  env?: Record<string, string>;
  path: string;
}): Promise<void> {
  const result = await runCommandAndWait({
    client: params.client,
    sandboxId: params.sandboxId,
    command: "test",
    args: ["-e", params.path],
    cwd: params.workingDirectory,
    env: params.env,
    signal: AbortSignal.timeout(DEFAULT_COMMAND_TIMEOUT_MS),
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `ENOENT: no such file or directory, access '${params.path}'`,
    );
  }
}

export async function mkdirDirect(params: {
  client: APIClient;
  sandboxId: string;
  workingDirectory: string;
  env?: Record<string, string>;
  path: string;
  options?: { recursive?: boolean };
}): Promise<void> {
  const args = params.options?.recursive ? ["-p", params.path] : [params.path];
  const result = await runCommandAndWait({
    client: params.client,
    sandboxId: params.sandboxId,
    command: "mkdir",
    args,
    cwd: params.workingDirectory,
    env: params.env,
    signal: AbortSignal.timeout(DEFAULT_COMMAND_TIMEOUT_MS),
  });

  if (result.exitCode !== 0) {
    const errorOutput = result.logs.combined;
    if (!errorOutput.includes("File exists") || !params.options?.recursive) {
      throw new Error(`Failed to create directory: ${params.path}`);
    }
  }
}

export async function readdirDirect(params: {
  client: APIClient;
  sandboxId: string;
  workingDirectory: string;
  env?: Record<string, string>;
  path: string;
}): Promise<Dirent[]> {
  const result = await runCommandAndWait({
    client: params.client,
    sandboxId: params.sandboxId,
    command: "find",
    args: [
      params.path,
      "-maxdepth",
      "1",
      "-mindepth",
      "1",
      "-printf",
      "%y %f\\n",
    ],
    cwd: params.workingDirectory,
    env: params.env,
    signal: AbortSignal.timeout(DEFAULT_COMMAND_TIMEOUT_MS),
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `ENOENT: no such file or directory, scandir '${params.path}'`,
    );
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
      parentPath: params.path,
      path: params.path,
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

export async function execDirect(params: {
  client: APIClient;
  sandboxId: string;
  cwd: string;
  command: string;
  timeoutMs: number;
  env?: Record<string, string>;
}): Promise<ExecResult> {
  const signal = AbortSignal.timeout(params.timeoutMs);

  try {
    const finished = await runCommandAndWait({
      client: params.client,
      sandboxId: params.sandboxId,
      command: "bash",
      args: ["-c", params.command],
      cwd: params.cwd,
      env: params.env,
      signal,
    });

    let stdout = finished.logs.combined;
    let truncated = false;

    if (stdout.length > MAX_OUTPUT_LENGTH) {
      stdout = stdout.slice(0, MAX_OUTPUT_LENGTH);
      truncated = true;
    }

    return {
      success: finished.exitCode === 0,
      exitCode: finished.exitCode,
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
        stderr: `Command timed out after ${params.timeoutMs}ms`,
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

export async function execDetachedDirect(params: {
  client: APIClient;
  sandboxId: string;
  command: string;
  cwd: string;
  env?: Record<string, string>;
}): Promise<{ commandId: string }> {
  const commandResponse = await params.client.runCommand({
    sandboxId: params.sandboxId,
    command: "bash",
    args: ["-c", params.command],
    cwd: params.cwd,
    env: params.env ?? {},
    sudo: false,
  });

  const commandId = commandResponse.json.command.id;
  const quickProbeSignal = AbortSignal.timeout(
    DETACHED_QUICK_FAILURE_WINDOW_MS,
  );

  try {
    const finished = await params.client.getCommand({
      sandboxId: params.sandboxId,
      cmdId: commandId,
      wait: true,
      signal: quickProbeSignal,
    });

    const exitCode = finished.json.command.exitCode;
    if (exitCode !== 0) {
      const logs = await collectLogs(
        params.client,
        params.sandboxId,
        commandId,
      );
      const trimmedStderr = logs.stderr.trim();
      const stderrSnippet = (
        trimmedStderr ||
        logs.combined.trim() ||
        "<no stderr>"
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
