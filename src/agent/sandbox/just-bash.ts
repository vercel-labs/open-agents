import { Bash, OverlayFs } from "just-bash";
import type { Dirent } from "fs";
import type {
  Sandbox,
  SandboxStats,
  ExecResult,
  SandboxHooks,
} from "./interface";

const MAX_OUTPUT_LENGTH = 50_000;

export interface JustBashSandboxConfig {
  /**
   * The working directory for this sandbox.
   * In overlay mode, this is the root directory that will be mounted.
   * In memory mode, this path is used as the logical working directory.
   */
  workingDirectory: string;

  /**
   * Environment variables available to commands.
   */
  env?: Record<string, string>;

  /**
   * Initial files to populate in the virtual filesystem.
   * Keys are absolute paths, values are file contents.
   */
  files?: Record<string, string>;

  /**
   * Lifecycle hooks for setup and teardown.
   */
  hooks?: SandboxHooks;

  /**
   * Filesystem mode:
   * - "memory": Pure in-memory filesystem (default). All files must be provided via `files` option.
   * - "overlay": Copy-on-write over a real directory. Reads come from disk, writes stay in memory.
   */
  mode?: "memory" | "overlay";

  /**
   * Execution limits for protecting against infinite loops and deep recursion.
   */
  executionLimits?: {
    maxCallDepth?: number;
    maxCommandCount?: number;
    maxLoopIterations?: number;
  };
}

/**
 * Sandbox implementation using just-bash - a simulated bash environment
 * with an in-memory virtual filesystem.
 *
 * This sandbox provides a secure, isolated bash environment without
 * spawning real shell processes. All file operations happen in memory
 * (or copy-on-write with OverlayFs).
 *
 * Key features:
 * - No real shell process spawning
 * - In-memory or overlay filesystem
 * - Configurable execution limits
 * - Full lifecycle hook support
 */
export class JustBashSandbox implements Sandbox {
  readonly type = "just-bash";
  readonly workingDirectory: string;
  readonly env?: Record<string, string>;
  readonly hooks?: SandboxHooks;
  readonly environmentDetails =
    `- Simulated shell environment (not a real bash process)
- Git is NOT available - do not attempt git operations
- Limited to basic file operations and shell commands
- No package installation or network access`;

  private bash: Bash;
  private mode: "memory" | "overlay";

  private constructor(
    workingDirectory: string,
    bash: Bash,
    mode: "memory" | "overlay",
    env?: Record<string, string>,
    hooks?: SandboxHooks,
  ) {
    this.workingDirectory = workingDirectory;
    this.bash = bash;
    this.mode = mode;
    this.env = env;
    this.hooks = hooks;
  }

  /**
   * Create a new JustBashSandbox instance.
   */
  static async create(config: JustBashSandboxConfig): Promise<JustBashSandbox> {
    const {
      workingDirectory,
      env,
      files,
      hooks,
      mode = "memory",
      executionLimits,
    } = config;

    let bash: Bash;
    let effectiveWorkingDirectory: string;

    if (mode === "overlay") {
      const overlayFs = new OverlayFs({ root: workingDirectory });
      const mountPoint = overlayFs.getMountPoint();
      bash = new Bash({
        fs: overlayFs,
        cwd: mountPoint,
        env,
        executionLimits,
      });
      // In overlay mode, use the mount point as the working directory
      // since the real path doesn't exist in the virtual filesystem
      effectiveWorkingDirectory = mountPoint;
    } else {
      // Memory mode - pure in-memory filesystem
      bash = new Bash({
        files: files ?? {},
        cwd: workingDirectory,
        env,
        executionLimits,
      });
      effectiveWorkingDirectory = workingDirectory;
    }

    const sandbox = new JustBashSandbox(
      effectiveWorkingDirectory,
      bash,
      mode,
      env,
      hooks,
    );

    // Run afterStart hook if provided
    if (hooks?.afterStart) {
      await hooks.afterStart(sandbox);
    }

    return sandbox;
  }

  async readFile(path: string, _encoding: "utf-8"): Promise<string> {
    // Use cat command to read file contents
    const result = await this.bash.exec(`cat "${path}"`);
    if (result.exitCode !== 0) {
      const error = new Error(
        result.stderr || `ENOENT: no such file or directory, open '${path}'`,
      );
      (error as NodeJS.ErrnoException).code = "ENOENT";
      throw error;
    }
    return result.stdout;
  }

  async writeFile(
    path: string,
    content: string,
    _encoding: "utf-8",
  ): Promise<void> {
    // Ensure parent directory exists
    const parentDir = path.substring(0, path.lastIndexOf("/"));
    if (parentDir) {
      await this.bash.exec(`mkdir -p "${parentDir}"`);
    }

    // Use heredoc to write content (handles special characters)
    // Escape any single quotes in the content
    const escapedContent = content.replace(/'/g, "'\\''");
    const result = await this.bash.exec(
      `printf '%s' '${escapedContent}' > "${path}"`,
    );

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `Failed to write file: ${path}`);
    }
  }

  async stat(path: string): Promise<SandboxStats> {
    // Check if path exists and get its type
    const result = await this.bash.exec(`stat "${path}" 2>/dev/null`);
    if (result.exitCode !== 0) {
      const error = new Error(
        `ENOENT: no such file or directory, stat '${path}'`,
      );
      (error as NodeJS.ErrnoException).code = "ENOENT";
      throw error;
    }

    // Check if it's a directory
    const dirCheck = await this.bash.exec(`test -d "${path}" && echo "dir"`);
    const isDir = dirCheck.stdout.trim() === "dir";

    // Get file size
    let size = 0;
    if (!isDir) {
      const sizeResult = await this.bash.exec(`wc -c < "${path}"`);
      size = parseInt(sizeResult.stdout.trim(), 10) || 0;
    }

    return {
      isDirectory: () => isDir,
      isFile: () => !isDir,
      size,
      mtimeMs: Date.now(), // just-bash doesn't track mtimes precisely
    };
  }

  async access(path: string): Promise<void> {
    const result = await this.bash.exec(`test -e "${path}"`);
    if (result.exitCode !== 0) {
      const error = new Error(
        `ENOENT: no such file or directory, access '${path}'`,
      );
      (error as NodeJS.ErrnoException).code = "ENOENT";
      throw error;
    }
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const flags = options?.recursive ? "-p" : "";
    const result = await this.bash.exec(`mkdir ${flags} "${path}"`);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `Failed to create directory: ${path}`);
    }
  }

  async readdir(
    path: string,
    _options: { withFileTypes: true },
  ): Promise<Dirent[]> {
    // List directory contents
    const result = await this.bash.exec(
      `ls -1 "${path}" 2>/dev/null || echo ""`,
    );

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      // Check if directory exists
      const existsCheck = await this.bash.exec(`test -d "${path}"`);
      if (existsCheck.exitCode !== 0) {
        const error = new Error(
          `ENOENT: no such file or directory, scandir '${path}'`,
        );
        (error as NodeJS.ErrnoException).code = "ENOENT";
        throw error;
      }
      return [];
    }

    const entries = result.stdout.trim().split("\n").filter(Boolean);
    const dirents: Dirent[] = [];

    for (const entry of entries) {
      const entryPath = path.endsWith("/")
        ? `${path}${entry}`
        : `${path}/${entry}`;
      const dirCheck = await this.bash.exec(`test -d "${entryPath}"`);
      const isDir = dirCheck.exitCode === 0;

      // Create a Dirent-compatible object
      dirents.push({
        name: entry,
        parentPath: path,
        path: entryPath,
        isDirectory: () => isDir,
        isFile: () => !isDir,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false,
      } as Dirent);
    }

    return dirents;
  }

  async exec(
    command: string,
    cwd: string,
    _timeoutMs: number,
  ): Promise<ExecResult> {
    // Execute command with the specified cwd
    const result = await this.bash.exec(command, { cwd });

    let stdout = result.stdout;
    let stderr = result.stderr;
    let truncated = false;

    // Truncate output if necessary
    if (stdout.length > MAX_OUTPUT_LENGTH) {
      stdout = stdout.slice(0, MAX_OUTPUT_LENGTH);
      truncated = true;
    }
    if (stderr.length > MAX_OUTPUT_LENGTH) {
      stderr = stderr.slice(0, MAX_OUTPUT_LENGTH);
      truncated = true;
    }

    return {
      success: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout,
      stderr,
      truncated,
    };
  }

  async stop(): Promise<void> {
    // Run beforeStop hook if provided
    if (this.hooks?.beforeStop) {
      await this.hooks.beforeStop(this);
    }
    // No resources to clean up for just-bash
  }
}

/**
 * Create a new JustBashSandbox instance.
 *
 * @example
 * // In-memory mode (default)
 * const sandbox = await createJustBashSandbox({
 *   workingDirectory: "/app",
 *   files: { "/app/data.json": '{"key": "value"}' },
 * });
 *
 * @example
 * // Overlay mode - reads from disk, writes stay in memory
 * const sandbox = await createJustBashSandbox({
 *   workingDirectory: "/path/to/project",
 *   mode: "overlay",
 * });
 */
export async function createJustBashSandbox(
  config: JustBashSandboxConfig,
): Promise<Sandbox> {
  return JustBashSandbox.create(config);
}
