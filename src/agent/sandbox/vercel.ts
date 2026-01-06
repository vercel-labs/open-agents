import { Sandbox as VercelSandboxSDK } from "@vercel/sandbox";
import type { Dirent } from "fs";
import type { Sandbox, SandboxStats, ExecResult } from "./interface";

const MAX_OUTPUT_LENGTH = 50_000;
const DEFAULT_WORKING_DIRECTORY = "/vercel/sandbox";

export interface VercelSandboxConfig {
  /**
   * Optional GitHub repository source to clone into the sandbox.
   * If not provided, the sandbox starts empty.
   */
  source?: {
    /** GitHub repository URL (e.g., "https://github.com/owner/repo") */
    url: string;
    /** Branch to clone (defaults to "main") */
    branch?: string;
    /** Token for authenticated git access (e.g., GitHub PAT). Enables push operations. */
    token?: string;
    /**
     * Create and checkout a new branch after cloning.
     * Useful for isolating agent changes from the main branch.
     */
    newBranch?: string;
  };
  /**
   * Environment variables to make available to all commands in the sandbox.
   * Useful for API keys, tokens, and other secrets.
   */
  env?: Record<string, string>;
  /**
   * Number of vCPUs (1-8). Each vCPU provides 2048 MB of memory.
   * @default 2
   */
  vcpus?: number;
  /**
   * Sandbox timeout in milliseconds.
   * @default 300_000 (5 minutes)
   */
  timeout?: number;
  /**
   * Runtime environment.
   * @default "node22"
   */
  runtime?: "node22" | "node24" | "python3.13";
  /**
   * Ports to expose from the sandbox.
   */
  ports?: number[];
}

/**
 * Vercel Sandbox implementation using the @vercel/sandbox SDK.
 * Runs code in isolated Firecracker MicroVMs.
 */
export class VercelSandbox implements Sandbox {
  /**
   * Unique identifier for this sandbox.
   * Use this to reconnect to an existing sandbox via `connectVercelSandbox({ sandboxId })`.
   */
  readonly id: string;
  readonly workingDirectory: string;
  readonly env?: Record<string, string>;
  /**
   * The current git branch in the sandbox.
   * Set when a newBranch is created, or when cloning from a specific branch.
   */
  readonly currentBranch?: string;
  private sdk: VercelSandboxSDK;

  private constructor(
    sdk: VercelSandboxSDK,
    id: string,
    workingDirectory: string,
    env?: Record<string, string>,
    currentBranch?: string,
  ) {
    this.sdk = sdk;
    this.id = id;
    this.workingDirectory = workingDirectory;
    this.env = env;
    this.currentBranch = currentBranch;
  }

  /**
   * Create a new Vercel Sandbox instance.
   * If a source is provided, the repo will be cloned into the working directory.
   */
  static async create(
    config: VercelSandboxConfig = {},
  ): Promise<VercelSandbox> {
    const {
      source,
      env,
      vcpus = 2,
      timeout = 300_000,
      runtime = "node22",
      ports,
    } = config;

    // Build the source config with optional authentication
    const sourceConfig = source
      ? source.token
        ? {
            type: "git" as const,
            url: source.url,
            username: "x-access-token",
            password: source.token,
            ...(source.branch && { revision: source.branch }),
          }
        : {
            type: "git" as const,
            url: source.url,
            ...(source.branch && { revision: source.branch }),
          }
      : undefined;

    const sdk = await VercelSandboxSDK.create({
      ...(sourceConfig && { source: sourceConfig }),
      resources: { vcpus },
      timeout,
      runtime,
      ...(ports && { ports }),
    });

    const workingDirectory = DEFAULT_WORKING_DIRECTORY;

    // Configure git to use the token for push operations if provided
    if (source?.token) {
      await sdk.runCommand({
        cmd: "git",
        args: [
          "config",
          "credential.helper",
          `!f() { echo "username=x-access-token"; echo "password=${source.token}"; }; f`,
        ],
        cwd: workingDirectory,
      });
    }

    // Track the current branch
    let currentBranch: string | undefined;

    // Create and checkout a new branch if specified
    if (source?.newBranch) {
      const checkoutResult = await sdk.runCommand({
        cmd: "git",
        args: ["checkout", "-b", source.newBranch],
        cwd: workingDirectory,
      });

      if (checkoutResult.exitCode !== 0) {
        throw new Error(
          `Failed to create branch '${source.newBranch}': ${await checkoutResult.stdout()}`,
        );
      }

      currentBranch = source.newBranch;
    } else if (source?.branch) {
      currentBranch = source.branch;
    }

    return new VercelSandbox(
      sdk,
      sdk.sandboxId,
      workingDirectory,
      env,
      currentBranch,
    );
  }

  /**
   * Connect to an existing Vercel Sandbox by ID.
   */
  static async connect(
    sandboxId: string,
    options: { env?: Record<string, string> } = {},
  ): Promise<VercelSandbox> {
    const sdk = await VercelSandboxSDK.get({ sandboxId });
    return new VercelSandbox(
      sdk,
      sandboxId,
      DEFAULT_WORKING_DIRECTORY,
      options.env,
    );
  }

  async readFile(path: string, _encoding: "utf-8"): Promise<string> {
    const result = await this.sdk.runCommand({
      cmd: "cat",
      args: [path],
      env: this.env,
    });

    if (result.exitCode !== 0) {
      throw new Error(`Failed to read file: ${path}`);
    }

    return result.stdout();
  }

  async writeFile(
    path: string,
    content: string,
    _encoding: "utf-8",
  ): Promise<void> {
    // Ensure parent directory exists
    const parentDir = path.substring(0, path.lastIndexOf("/"));
    if (parentDir) {
      await this.mkdir(parentDir, { recursive: true });
    }

    // Use base64 encoding to safely handle special characters
    const base64Content = Buffer.from(content, "utf-8").toString("base64");
    const result = await this.sdk.runCommand({
      cmd: "bash",
      args: ["-c", `echo "${base64Content}" | base64 -d > "${path}"`],
      env: this.env,
    });

    if (result.exitCode !== 0) {
      throw new Error(`Failed to write file: ${path}`);
    }
  }

  async stat(path: string): Promise<SandboxStats> {
    // Use stat command to get file info
    const result = await this.sdk.runCommand({
      cmd: "stat",
      args: ["-c", "%F %s %Y", path],
      env: this.env,
    });

    if (result.exitCode !== 0) {
      throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
    }

    const output = (await result.stdout()).trim();
    const [fileType, sizeStr, mtimeStr] = output.split(" ");

    const isDir = fileType === "directory";
    const size = parseInt(sizeStr ?? "0", 10);
    const mtimeMs = parseInt(mtimeStr ?? "0", 10) * 1000;

    return {
      isDirectory: () => isDir,
      isFile: () => !isDir,
      size,
      mtimeMs,
    };
  }

  async access(path: string): Promise<void> {
    const result = await this.sdk.runCommand({
      cmd: "test",
      args: ["-e", path],
      env: this.env,
    });

    if (result.exitCode !== 0) {
      throw new Error(`ENOENT: no such file or directory, access '${path}'`);
    }
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const args = options?.recursive ? ["-p", path] : [path];
    const result = await this.sdk.runCommand({
      cmd: "mkdir",
      args,
      env: this.env,
    });

    if (result.exitCode !== 0) {
      const stderr = await result.stdout(); // stdout contains error in some cases
      if (!stderr.includes("File exists") || !options?.recursive) {
        throw new Error(`Failed to create directory: ${path}`);
      }
    }
  }

  async readdir(
    path: string,
    _options: { withFileTypes: true },
  ): Promise<Dirent[]> {
    // List files with type info using find
    const result = await this.sdk.runCommand({
      cmd: "bash",
      args: ["-c", `find "${path}" -maxdepth 1 -mindepth 1 -printf "%y %f\\n"`],
      env: this.env,
    });

    if (result.exitCode !== 0) {
      throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
    }

    const output = (await result.stdout()).trim();
    if (!output) {
      return [];
    }

    const entries: Dirent[] = output.split("\n").map((line) => {
      const [type, ...nameParts] = line.split(" ");
      const name = nameParts.join(" ");
      const isDir = type === "d";
      const isFile = type === "f";
      const isSymlink = type === "l";

      // Create a Dirent-like object
      return {
        name,
        parentPath: path,
        path: path,
        isDirectory: () => isDir,
        isFile: () => isFile,
        isSymbolicLink: () => isSymlink,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isFIFO: () => false,
        isSocket: () => false,
      } as Dirent;
    });

    return entries;
  }

  async exec(
    command: string,
    cwd: string,
    timeoutMs: number,
  ): Promise<ExecResult> {
    try {
      const result = await this.sdk.runCommand({
        cmd: "bash",
        args: ["-c", `cd "${cwd}" && ${command}`],
        env: this.env,
        signal: AbortSignal.timeout(timeoutMs),
      });

      let stdout = await result.stdout();
      let truncated = false;

      if (stdout.length > MAX_OUTPUT_LENGTH) {
        stdout = stdout.slice(0, MAX_OUTPUT_LENGTH);
        truncated = true;
      }

      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout,
        stderr: "", // Vercel SDK combines stdout/stderr
        truncated,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
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

  /**
   * Get the public URL for an exposed port.
   */
  domain(port: number): string {
    return this.sdk.domain(port);
  }

  /**
   * Stop and clean up the sandbox.
   */
  async stop(): Promise<void> {
    await this.sdk.stop();
  }
}

/**
 * Configuration for reconnecting to an existing sandbox.
 */
export interface VercelSandboxConnectConfig {
  /** The sandbox ID to reconnect to */
  sandboxId: string;
  /** Environment variables to make available to commands */
  env?: Record<string, string>;
}

/**
 * Connect to a Vercel Sandbox - either create a new one or reconnect to an existing one.
 *
 * @param config - Configuration options. Pass `sandboxId` to reconnect, or other options to create new.
 *
 * @example
 * // Start empty sandbox
 * const sandbox = await connectVercelSandbox();
 * console.log(sandbox.id); // Save this ID for reconnection
 *
 * @example
 * // Reconnect to an existing sandbox
 * const sandbox = await connectVercelSandbox({ sandboxId: "saved-sandbox-id" });
 *
 * @example
 * // Clone a repo into a new sandbox
 * const sandbox = await connectVercelSandbox({
 *   source: {
 *     url: "https://github.com/owner/repo",
 *     branch: "develop",
 *   },
 * });
 *
 * @example
 * // Clone with authentication and create a new branch for agent work
 * const sandbox = await connectVercelSandbox({
 *   source: {
 *     url: "https://github.com/owner/repo",
 *     branch: "main",
 *     token: process.env.GITHUB_TOKEN,
 *     newBranch: "agent/feature-123",
 *   },
 *   env: {
 *     GITHUB_TOKEN: process.env.GITHUB_TOKEN,
 *   },
 * });
 *
 * // The sandbox exposes the ID and current branch
 * console.log(sandbox.id); // "sandbox-abc123"
 * console.log(sandbox.currentBranch); // "agent/feature-123"
 */
export async function connectVercelSandbox(
  config: VercelSandboxConfig | VercelSandboxConnectConfig = {},
): Promise<VercelSandbox> {
  if ("sandboxId" in config) {
    return VercelSandbox.connect(config.sandboxId, { env: config.env });
  }
  return VercelSandbox.create(config);
}
