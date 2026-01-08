import * as fs from "fs/promises";
import { spawn } from "child_process";
import type { Dirent } from "fs";
import type { Sandbox, SandboxStats, ExecResult } from "./interface";

const MAX_OUTPUT_LENGTH = 50_000;

/**
 * Local sandbox implementation using Node.js fs/promises and child_process.
 * This is the default sandbox used when no custom sandbox is provided.
 *
 * Note: Lifecycle hooks are not supported for local sandboxes.
 * Use VercelSandbox for hooks support.
 */
export class LocalSandbox implements Sandbox {
  readonly type = "local";
  readonly workingDirectory: string;
  readonly env?: Record<string, string>;

  constructor(workingDirectory: string, env?: Record<string, string>) {
    this.workingDirectory = workingDirectory;
    this.env = env;
  }

  async readFile(path: string, encoding: "utf-8"): Promise<string> {
    return fs.readFile(path, encoding);
  }

  async writeFile(
    path: string,
    content: string,
    encoding: "utf-8",
  ): Promise<void> {
    await fs.writeFile(path, content, encoding);
  }

  async stat(path: string): Promise<SandboxStats> {
    const stats = await fs.stat(path);
    return {
      isDirectory: () => stats.isDirectory(),
      isFile: () => stats.isFile(),
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    };
  }

  async access(path: string): Promise<void> {
    await fs.access(path);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(path, options);
  }

  async readdir(
    path: string,
    options: { withFileTypes: true },
  ): Promise<Dirent[]> {
    return fs.readdir(path, options);
  }

  async exec(
    command: string,
    cwd: string,
    timeoutMs: number,
  ): Promise<ExecResult> {
    return new Promise((resolve) => {
      const child = spawn("bash", ["-c", command], {
        cwd,
        env: { ...process.env, ...this.env },
        timeout: timeoutMs,
      });

      let stdout = "";
      let stderr = "";
      let truncated = false;

      child.stdout.on("data", (data) => {
        const chunk = data.toString();
        if (stdout.length + chunk.length > MAX_OUTPUT_LENGTH) {
          stdout += chunk.slice(0, MAX_OUTPUT_LENGTH - stdout.length);
          truncated = true;
        } else {
          stdout += chunk;
        }
      });

      child.stderr.on("data", (data) => {
        const chunk = data.toString();
        if (stderr.length + chunk.length > MAX_OUTPUT_LENGTH) {
          stderr += chunk.slice(0, MAX_OUTPUT_LENGTH - stderr.length);
          truncated = true;
        } else {
          stderr += chunk;
        }
      });

      child.on("close", (code) => {
        resolve({
          success: code === 0,
          exitCode: code,
          stdout,
          stderr,
          truncated,
        });
      });

      child.on("error", (error) => {
        resolve({
          success: false,
          exitCode: null,
          stdout,
          stderr: error.message,
          truncated,
        });
      });
    });
  }

  async stop(): Promise<void> {
    // No-op for local sandbox
  }
}

/**
 * Create a new local sandbox instance.
 * Use this as the default when no custom sandbox is provided.
 *
 * @param workingDirectory - The root directory for sandbox operations
 * @param env - Optional environment variables to make available to commands (merged with process.env)
 */
export function createLocalSandbox(
  workingDirectory: string,
  env?: Record<string, string>,
): Sandbox {
  return new LocalSandbox(workingDirectory, env);
}
