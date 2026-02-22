import { Sandbox as VercelSandboxSDK } from "@vercel/sandbox";
import type { Dirent } from "fs";
import type {
  ExecResult,
  Sandbox,
  SandboxHooks,
  SandboxStats,
  SnapshotResult,
} from "../interface";
import type { SandboxStatus } from "../types";
import type { VercelSandboxConfig, VercelSandboxConnectConfig } from "./config";
import type { VercelState } from "./state";

const MAX_OUTPUT_LENGTH = 50_000;
const DEFAULT_WORKING_DIRECTORY = "/vercel/sandbox";
const TIMEOUT_BUFFER_MS = 30_000; // 30 seconds buffer for beforeStop hook
const MAX_SDK_TIMEOUT_MS = 18_000_000; // Vercel API limit: 5 hours
const MAX_PROACTIVE_TIMEOUT_MS = MAX_SDK_TIMEOUT_MS - TIMEOUT_BUFFER_MS;
const DEFAULT_RECONNECT_TIMEOUT_MS = 300_000; // 5 minutes default timeout for reconnected sandboxes
const DETACHED_QUICK_FAILURE_WINDOW_MS = 2_000;

interface SandboxRouteLike {
  port: number;
}

function buildAuthenticatedGitHubUrl(
  repoUrl: string,
  token: string,
): string | null {
  const githubUrlMatch = repoUrl.match(
    /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/,
  );

  if (!githubUrlMatch) {
    return null;
  }

  const [, owner, repo] = githubUrlMatch;
  return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
}

/**
 * Vercel Sandbox implementation using the @vercel/sandbox SDK.
 * Runs code in isolated Firecracker MicroVMs.
 */
export class VercelSandbox implements Sandbox {
  readonly type = "cloud" as const;
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
  readonly hooks?: SandboxHooks;

  private sdk: VercelSandboxSDK;
  private timeoutTimer?: ReturnType<typeof setTimeout>;
  private isStopped = false;
  private _expiresAt?: number;
  private _timeout?: number;
  private _ports?: number[];

  /**
   * Timestamp (ms since epoch) when this sandbox will be proactively stopped.
   * This value is updated when timeout is extended via extendTimeout().
   */
  get expiresAt(): number | undefined {
    return this._expiresAt;
  }

  /**
   * The initial configured proactive timeout duration in milliseconds.
   * Note: This is the original timeout value, not affected by extendTimeout() calls.
   * Use expiresAt to get the current expiration time.
   */
  get timeout(): number | undefined {
    return this._timeout;
  }

  private constructor(
    sdk: VercelSandboxSDK,
    id: string,
    workingDirectory: string,
    env?: Record<string, string>,
    currentBranch?: string,
    hooks?: SandboxHooks,
    timeout?: number,
    startTime?: number,
    ports?: number[],
  ) {
    this.sdk = sdk;
    this.id = id;
    this.workingDirectory = workingDirectory;
    this.env = env;
    this.currentBranch = currentBranch;
    this.hooks = hooks;
    this._ports = ports;

    // Set timeout tracking for proactive stop
    if (timeout !== undefined && startTime !== undefined) {
      this._timeout = timeout;
      this._expiresAt = startTime + timeout;
      this.scheduleProactiveStop();
    }
  }

  /**
   * Schedule a timer to call onTimeout hook before the SDK timeout.
   * Note: This does NOT call stop() - the client is responsible for stopping.
   * The TIMEOUT_BUFFER_MS gives the client time to save and stop after their countdown ends.
   */
  private scheduleProactiveStop(): void {
    if (this._expiresAt === undefined) return;

    const msUntilTimeout = this._expiresAt - Date.now();
    if (msUntilTimeout <= 0) return;

    this.timeoutTimer = setTimeout(async () => {
      try {
        if (this.isStopped) return;

        // Call onTimeout hook if configured (for CLI usage)
        if (this.hooks?.onTimeout) {
          try {
            await this.hooks.onTimeout(this);
          } catch (error) {
            console.error(
              "[VercelSandbox] onTimeout hook failed:",
              error instanceof Error ? error.message : error,
            );
          }
        }

        // Don't call stop() here - let the client handle it.
        // The SDK timeout (with TIMEOUT_BUFFER_MS) is the safety net.
      } catch (error) {
        console.warn(
          "[VercelSandbox] onTimeout handler failed:",
          error instanceof Error ? error.message : error,
        );
      }
    }, msUntilTimeout);
  }

  /**
   * Clear existing timeout timer and schedule a new one.
   */
  private rescheduleProactiveStop(): void {
    // Clear existing timer
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }
    // Schedule new timer
    this.scheduleProactiveStop();
  }

  /**
   * Extend the sandbox timeout by the specified duration.
   * @param additionalMs - Additional time in milliseconds
   * @returns New expiration timestamp
   */
  async extendTimeout(additionalMs: number): Promise<{ expiresAt: number }> {
    if (this.isStopped) {
      throw new Error("Cannot extend timeout on stopped sandbox");
    }
    if (this._expiresAt === undefined) {
      throw new Error("Timeout tracking not enabled for this sandbox");
    }

    // Check if SDK supports extendTimeout
    if (typeof this.sdk.extendTimeout !== "function") {
      throw new Error(
        "extendTimeout is not supported by this version of @vercel/sandbox",
      );
    }

    // Call Vercel SDK to extend
    await this.sdk.extendTimeout(additionalMs);

    // Update internal state
    this._expiresAt += additionalMs;

    // Reschedule proactive stop timer
    this.rescheduleProactiveStop();

    // Call hook if provided
    if (this.hooks?.onTimeoutExtended) {
      try {
        await this.hooks.onTimeoutExtended(this, additionalMs);
      } catch (error) {
        console.error(
          "[VercelSandbox] onTimeoutExtended hook failed:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    return { expiresAt: this._expiresAt };
  }

  /**
   * The base host/domain for this sandbox (e.g., "abc123.vercel.run").
   * To get the full URL for an exposed port, use the `domain(port)` method
   * which returns the correct subdomain-based URL for that port.
   */
  get host(): string | undefined {
    const candidatePorts = this.getCandidatePorts();

    for (const port of candidatePorts) {
      try {
        const domainUrl = this.sdk.domain(port);
        return new URL(domainUrl).host;
      } catch {
        // Try next declared port; some restored sandboxes may not expose all ports.
      }
    }

    // Fallback for cases where no ports were declared but default HTTP route exists.
    if (!candidatePorts.includes(80)) {
      try {
        const domainUrl = this.sdk.domain(80);
        return new URL(domainUrl).host;
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  get environmentDetails(): string {
    const host = this.host;
    const previewPorts = this.getPreviewPorts();
    const portPreviewLines =
      previewPorts
        ?.map((port) => {
          try {
            const url = this.domain(port);
            return `  - Port ${port}: ${url}`;
          } catch {
            return undefined;
          }
        })
        .filter((line): line is string => line !== undefined) ?? [];

    const portLines = portPreviewLines.length
      ? `\n- Dev server preview URLs (start a server on one of these ports, then share the URL with the user):\n${portPreviewLines.join("\n")}`
      : "";

    const hostLine = host ? `\n- Sandbox host: ${host}` : "";
    const runtimeEnvLine =
      host || previewPorts.length > 0
        ? "\n- Runtime env vars for previews are injected into commands: SANDBOX_HOST and SANDBOX_URL_<PORT> (for routable ports)"
        : "";

    return `- Ephemeral sandbox - all work is lost unless committed and pushed to git
- Default workflow: create a new branch, commit changes, push, and open a PR (since the sandbox is ephemeral, this ensures work is preserved)
- All bash commands already run in the working directory by default — never prepend \`cd /vercel/sandbox &&\` or similar; just run the command directly
- Do NOT prefix any bash command with a \`cd\` to the working directory — commands like \`cd /vercel/sandbox && npm test\` are WRONG; just use \`npm test\`
- Git is already configured (user, email, remote auth) - no setup or verification needed
- GitHub CLI (gh) is NOT available - use curl with the GitHub API to create PRs
  Use the $GITHUB_TOKEN environment variable directly (do not paste the actual token):
  curl -X POST -H "Authorization: token $GITHUB_TOKEN" -H "Accept: application/vnd.github.v3+json" https://api.github.com/repos/OWNER/REPO/pulls -d '{"title":"...","head":"branch","base":"main","body":"..."}'
- Node.js runtime with npm/pnpm available
- Bun and jq are preinstalled
- This sandbox already runs on Vercel; do not suggest deploying to Vercel just to obtain a shareable preview link
${hostLine}${portLines}${runtimeEnvLine}`;
  }

  private getRoutePorts(): number[] {
    const routes = (this.sdk as { routes?: SandboxRouteLike[] }).routes;
    if (!Array.isArray(routes)) {
      return [];
    }

    return routes
      .map((route) => route.port)
      .filter((port) => Number.isInteger(port) && port > 0);
  }

  private getPreviewPorts(): number[] {
    return Array.from(
      new Set([...(this._ports ?? []), ...this.getRoutePorts()]),
    );
  }

  private getCandidatePorts(): number[] {
    return Array.from(new Set([...this.getPreviewPorts(), 80]));
  }

  private getRuntimePreviewEnv(): Record<string, string> {
    const runtimeEnv: Record<string, string> = {};
    const host = this.host;
    if (host) {
      runtimeEnv.SANDBOX_HOST = host;
    }

    for (const port of this.getPreviewPorts()) {
      try {
        runtimeEnv[`SANDBOX_URL_${port}`] = this.domain(port);
      } catch {
        // Skip unroutable ports
      }
    }

    return runtimeEnv;
  }

  private getCommandEnv(): Record<string, string> | undefined {
    const runtimePreviewEnv = this.getRuntimePreviewEnv();
    if (!this.env && Object.keys(runtimePreviewEnv).length === 0) {
      return undefined;
    }

    return {
      ...this.env,
      ...runtimePreviewEnv,
    };
  }

  /**
   * Create a new Vercel Sandbox instance.
   * If `baseSnapshotId` is provided, sandbox bootstraps from that snapshot first.
   * If a source is provided with `baseSnapshotId`, the repo is cloned after bootstrap.
   */
  static async create(
    config: VercelSandboxConfig = {},
  ): Promise<VercelSandbox> {
    const {
      source,
      gitUser,
      env,
      vcpus = 2,
      timeout = 300_000,
      runtime = "node22",
      ports,
      baseSnapshotId,
      hooks,
    } = config;

    // Clamp proactive timeout to stay under the SDK's hard max when buffer is applied.
    const effectiveTimeout = Math.min(timeout, MAX_PROACTIVE_TIMEOUT_MS);
    if (effectiveTimeout !== timeout) {
      console.warn(
        `[VercelSandbox] Requested timeout ${timeout}ms exceeds max supported proactive timeout ${MAX_PROACTIVE_TIMEOUT_MS}ms; clamping.`,
      );
    }

    // Calculate SDK timeout with buffer for beforeStop hook.
    const sdkTimeout = effectiveTimeout + TIMEOUT_BUFFER_MS;

    const createBaseConfig = {
      resources: { vcpus },
      timeout: sdkTimeout,
      runtime,
      ...(ports && { ports }),
    };

    let sdk: VercelSandboxSDK;
    if (baseSnapshotId) {
      sdk = await VercelSandboxSDK.create({
        ...createBaseConfig,
        source: { type: "snapshot", snapshotId: baseSnapshotId },
      });
    } else if (source) {
      sdk = await VercelSandboxSDK.create({
        ...createBaseConfig,
        source: source.token
          ? {
              type: "git",
              url: source.url,
              username: "x-access-token",
              password: source.token,
              ...(source.branch && { revision: source.branch }),
            }
          : {
              type: "git",
              url: source.url,
              ...(source.branch && { revision: source.branch }),
            },
      });
    } else {
      sdk = await VercelSandboxSDK.create(createBaseConfig);
    }

    const workingDirectory = DEFAULT_WORKING_DIRECTORY;

    // TODO: `git clone ... .` requires the directory to be empty. If the base
    // snapshot has files in /vercel/sandbox (dotfiles, tool configs, etc.), the
    // clone will fail. Consider using git init + remote add + fetch + checkout
    // instead, which works regardless of existing directory contents.
    if (source && baseSnapshotId) {
      const cloneUrl = source.token
        ? (buildAuthenticatedGitHubUrl(source.url, source.token) ?? source.url)
        : source.url;
      const cloneArgs = ["clone"];
      if (source.branch) {
        cloneArgs.push("--branch", source.branch);
      }
      cloneArgs.push(cloneUrl, ".");

      const cloneResult = await sdk.runCommand({
        cmd: "git",
        args: cloneArgs,
        cwd: workingDirectory,
      });

      if (cloneResult.exitCode !== 0) {
        throw new Error(
          `Failed to clone repository '${source.url}': ${await cloneResult.stderr()}`,
        );
      }
    }

    // Initialize git repo for empty sandboxes (no source provided)
    // This ensures git commands work consistently (e.g., for diff viewing)
    if (!source) {
      await sdk.runCommand({
        cmd: "git",
        args: ["init"],
        cwd: workingDirectory,
      });
    }

    // Configure git to use the token for push operations if provided
    // We modify the remote URL to embed credentials directly (standard CI/CD approach)
    // TODO: When baseSnapshotId is set, the token is already embedded in the
    // clone URL above, making this set-url call redundant for that path.
    if (source?.token) {
      const authenticatedUrl = buildAuthenticatedGitHubUrl(
        source.url,
        source.token,
      );
      if (authenticatedUrl) {
        await sdk.runCommand({
          cmd: "git",
          args: ["remote", "set-url", "origin", authenticatedUrl],
          cwd: workingDirectory,
        });
      }
    }

    // Configure git user for commits if provided
    if (gitUser) {
      await sdk.runCommand({
        cmd: "git",
        args: ["config", "user.name", gitUser.name],
        cwd: workingDirectory,
      });
      await sdk.runCommand({
        cmd: "git",
        args: ["config", "user.email", gitUser.email],
        cwd: workingDirectory,
      });
    }

    // Create initial empty commit for empty sandboxes so HEAD exists
    // This is required for git diff HEAD to work (e.g., diff viewer)
    // Must be done after gitUser config since git commit requires user info
    if (!source && gitUser) {
      await sdk.runCommand({
        cmd: "git",
        args: ["commit", "--allow-empty", "-m", "Initial commit"],
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
          `Failed to create branch '${source.newBranch}': ${await checkoutResult.stderr()}`,
        );
      }

      currentBranch = source.newBranch;
    } else if (source?.branch) {
      currentBranch = source.branch;
    }

    // Capture startTime AFTER all setup operations so users get their full timeout duration
    const startTime = Date.now();

    const sandbox = new VercelSandbox(
      sdk,
      sdk.sandboxId,
      workingDirectory,
      env,
      currentBranch,
      hooks,
      effectiveTimeout,
      startTime,
      ports,
    );

    // Call afterStart hook if provided
    if (hooks?.afterStart) {
      await hooks.afterStart(sandbox);
    }

    return sandbox;
  }

  /**
   * Connect to an existing Vercel Sandbox by ID.
   */
  static async connect(
    sandboxId: string,
    options: {
      env?: Record<string, string>;
      hooks?: SandboxHooks;
      /**
       * Remaining timeout in ms for this sandbox.
       * If not provided, defaults to DEFAULT_RECONNECT_TIMEOUT_MS (5 minutes).
       * This ensures timeout tracking and proactive stop work correctly.
       */
      remainingTimeout?: number;
      /** Ports that were declared at creation time (for preview URL display) */
      ports?: number[];
    } = {},
  ): Promise<VercelSandbox> {
    const sdk = await VercelSandboxSDK.get({ sandboxId });

    // Use provided remainingTimeout or default to DEFAULT_RECONNECT_TIMEOUT_MS
    // This ensures timeout tracking is always enabled for reconnected sandboxes,
    // allowing beforeStop and onTimeout hooks to fire properly.
    const remainingTimeout =
      options.remainingTimeout ?? DEFAULT_RECONNECT_TIMEOUT_MS;
    const startTime = Date.now();

    const sandbox = new VercelSandbox(
      sdk,
      sandboxId,
      DEFAULT_WORKING_DIRECTORY,
      options.env,
      undefined,
      options.hooks,
      remainingTimeout,
      startTime,
      options.ports,
    );

    // Call afterStart hook if provided (useful for reconnection setup)
    if (options.hooks?.afterStart) {
      await options.hooks.afterStart(sandbox);
    }

    return sandbox;
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
    // Use printf '%s' instead of echo to avoid interpreting backslash sequences
    const base64Content = Buffer.from(content, "utf-8").toString("base64");
    const result = await this.sdk.runCommand({
      cmd: "bash",
      args: ["-c", `printf '%s' "${base64Content}" | base64 -d > "${path}"`],
      env: this.env,
    });

    if (result.exitCode !== 0) {
      throw new Error(`Failed to write file: ${path}`);
    }
  }

  async stat(path: string): Promise<SandboxStats> {
    // Use stat command to get file info
    // Use tab delimiter to avoid issues with file types containing spaces (e.g., "regular file")
    const result = await this.sdk.runCommand({
      cmd: "stat",
      args: ["-c", "%F\t%s\t%Y", path],
      env: this.env,
    });

    if (result.exitCode !== 0) {
      throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
    }

    const output = (await result.stdout()).trim();
    const [fileType, sizeStr, mtimeStr] = output.split("\t");

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
        env: this.getCommandEnv(),
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
   * Execute a command in detached mode (returns immediately).
   * The command continues running in the background.
   */
  async execDetached(
    command: string,
    cwd: string,
  ): Promise<{ commandId: string }> {
    const result = await this.sdk.runCommand({
      cmd: "bash",
      args: ["-c", `cd "${cwd}" && ${command}`],
      env: this.getCommandEnv(),
      detached: true,
    });

    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutResult = new Promise<{ kind: "timeout" }>((resolve) => {
      timeoutId = setTimeout(() => {
        abortController.abort();
        resolve({ kind: "timeout" });
      }, DETACHED_QUICK_FAILURE_WINDOW_MS);
    });

    const waitResult = result
      .wait({ signal: abortController.signal })
      .then((finished) => ({ kind: "finished", finished }) as const)
      .catch((error: unknown) => ({ kind: "error", error }) as const);

    const quickProbe = await Promise.race([waitResult, timeoutResult]);

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (quickProbe.kind === "timeout") {
      return { commandId: result.cmdId };
    }

    if (quickProbe.kind === "error") {
      throw quickProbe.error;
    }

    if (quickProbe.finished.exitCode !== 0) {
      const stderr = await quickProbe.finished.stderr();
      const trimmedStderr = stderr.trim();
      const stderrSnippet = trimmedStderr
        ? trimmedStderr.slice(0, MAX_OUTPUT_LENGTH)
        : "<no stderr>";
      throw new Error(
        `Background command exited with code ${quickProbe.finished.exitCode}. stderr:\n${stderrSnippet}`,
      );
    }

    return { commandId: result.cmdId };
  }

  /**
   * Get the public URL for an exposed port.
   */
  domain(port: number): string {
    return this.sdk.domain(port);
  }

  /**
   * Create a native Vercel snapshot of the sandbox filesystem.
   * IMPORTANT: This automatically stops the sandbox after snapshot creation.
   */
  async snapshot(): Promise<SnapshotResult> {
    // Use native Vercel SDK snapshot method
    const snapshot = await this.sdk.snapshot();

    // Mark sandbox as stopped since native snapshot stops it automatically
    this.isStopped = true;

    // Clear proactive timeout timer
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }

    return {
      snapshotId: snapshot.snapshotId,
    };
  }

  /**
   * Stop and clean up the sandbox.
   * Calls beforeStop hook if provided before stopping the sandbox.
   * This method is idempotent - calling it multiple times is safe.
   */
  async stop(): Promise<void> {
    // Ensure stop() only runs once
    if (this.isStopped) return;
    this.isStopped = true;

    // Clear proactive timeout timer
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }

    // Run beforeStop hook
    if (this.hooks?.beforeStop) {
      try {
        await this.hooks.beforeStop(this);
      } catch (error) {
        console.error(
          "[VercelSandbox] beforeStop hook failed:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    await this.sdk.stop();
  }

  /**
   * Get the current status of the sandbox.
   */
  get status(): SandboxStatus {
    if (this.isStopped) return "stopped";
    return "ready";
  }

  /**
   * Get the current state for persistence.
   * Returns state that can be passed to `connectSandbox()` to restore this sandbox.
   */
  getState(): { type: "vercel" } & VercelState {
    return {
      type: "vercel",
      sandboxId: this.id,
      expiresAt: this.expiresAt,
    };
  }
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
 * // Clone with authentication, create a branch, and enable commits/push
 * const sandbox = await connectVercelSandbox({
 *   source: {
 *     url: "https://github.com/owner/repo",
 *     branch: "main",
 *     token: process.env.GITHUB_TOKEN,
 *     newBranch: "agent/feature-123",
 *   },
 *   gitUser: {
 *     name: "AI Agent",
 *     email: "agent@example.com",
 *   },
 *   env: {
 *     GITHUB_TOKEN: process.env.GITHUB_TOKEN,
 *   },
 * });
 *
 * // The sandbox exposes the ID and current branch
 * console.log(sandbox.id); // "sandbox-abc123"
 * console.log(sandbox.currentBranch); // "agent/feature-123"
 *
 * // Now the agent can commit and push changes:
 * await sandbox.exec("git add . && git commit -m 'feat: add feature'", sandbox.workingDirectory, 30000);
 * await sandbox.exec("git push -u origin agent/feature-123", sandbox.workingDirectory, 60000);
 */
export async function connectVercelSandbox(
  config: VercelSandboxConfig | VercelSandboxConnectConfig = {},
): Promise<VercelSandbox> {
  if ("sandboxId" in config) {
    return VercelSandbox.connect(config.sandboxId, {
      env: config.env,
      hooks: config.hooks,
      remainingTimeout: config.remainingTimeout,
    });
  }
  return VercelSandbox.create(config);
}
