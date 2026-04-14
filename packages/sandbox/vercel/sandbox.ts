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

interface SandboxNetworkTransform {
  headers?: Record<string, string>;
}

interface SandboxNetworkRule {
  transform?: SandboxNetworkTransform[];
}

interface SandboxNetworkPolicy {
  allow: Record<string, SandboxNetworkRule[]>;
}

const DEFAULT_NETWORK_POLICY: SandboxNetworkPolicy = {
  allow: {
    "*": [],
  },
};

function buildGitHubCredentialBrokeringPolicy(
  token?: string,
): SandboxNetworkPolicy {
  if (!token) {
    return DEFAULT_NETWORK_POLICY;
  }

  const basicAuthToken = Buffer.from(
    `x-access-token:${token}`,
    "utf-8",
  ).toString("base64");

  return {
    allow: {
      "api.github.com": [
        {
          transform: [{ headers: { Authorization: `Bearer ${token}` } }],
        },
      ],
      "uploads.github.com": [
        {
          transform: [{ headers: { Authorization: `Bearer ${token}` } }],
        },
      ],
      "codeload.github.com": [
        {
          transform: [{ headers: { Authorization: `Bearer ${token}` } }],
        },
      ],
      "github.com": [
        {
          transform: [
            { headers: { Authorization: `Basic ${basicAuthToken}` } },
          ],
        },
      ],
      "*": [],
    },
  };
}

async function syncGitHubCredentialBrokering(
  sdk: VercelSandboxSDK,
  token?: string,
): Promise<void> {
  const updateNetworkPolicy = (
    sdk as VercelSandboxSDK & {
      updateNetworkPolicy?: (policy: SandboxNetworkPolicy) => Promise<void>;
    }
  ).updateNetworkPolicy;

  if (typeof updateNetworkPolicy !== "function") {
    if (token) {
      throw new Error(
        "Current @vercel/sandbox SDK does not support network policy updates required for GitHub credential brokering",
      );
    }
    return;
  }

  await updateNetworkPolicy.call(
    sdk,
    buildGitHubCredentialBrokeringPolicy(token),
  );
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

type VercelSandboxSession = ReturnType<
  InstanceType<typeof VercelSandboxSDK>["currentSession"]
>;

function isStoppedSessionStatus(status: string | undefined): boolean {
  return (
    status === "stopped" ||
    status === "stopping" ||
    status === "snapshotting" ||
    status === "aborted" ||
    status === "failed"
  );
}

function getRemainingTimeoutFromSession(
  session: VercelSandboxSession,
): number | undefined {
  const timeout = session.timeout;
  if (typeof timeout !== "number" || timeout <= 0) {
    return undefined;
  }

  const startedAt =
    session.startedAt?.getTime() ?? session.requestedAt?.getTime();
  if (typeof startedAt !== "number") {
    return undefined;
  }

  const proactiveTimeout = Math.max(timeout - TIMEOUT_BUFFER_MS, 0);
  const remaining = startedAt + proactiveTimeout - Date.now();
  return remaining > 10_000 ? remaining : undefined;
}

/**
 * Vercel Sandbox implementation using the @vercel/sandbox SDK.
 * Runs code in isolated Firecracker MicroVMs.
 */
export class VercelSandbox implements Sandbox {
  readonly type = "cloud" as const;
  /** Durable persistent sandbox name. */
  readonly name: string;
  /** Current runtime session identifier. */
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
  private session: VercelSandboxSession;
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
    session: VercelSandboxSession,
    name: string,
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
    this.session = session;
    this.name = name;
    this.id = id;
    this.workingDirectory = workingDirectory;
    this.env = env;
    this.currentBranch = currentBranch;
    this.hooks = hooks;
    this._ports = ports;
    this.isStopped = isStoppedSessionStatus(session.status);

    // Set timeout tracking for proactive stop
    if (!this.isStopped && timeout !== undefined && startTime !== undefined) {
      this._timeout = timeout;
      this._expiresAt = startTime + timeout;
      this.scheduleProactiveStop();
    }
  }

  private refreshStateFromCurrentSession(): void {
    const currentSession = this.sdk.currentSession();
    const nextIsStopped = isStoppedSessionStatus(currentSession.status);
    const shouldRefresh =
      currentSession.sessionId !== this.session.sessionId ||
      nextIsStopped !== this.isStopped ||
      (!nextIsStopped && this._expiresAt === undefined);

    if (!shouldRefresh) {
      return;
    }

    this.session = currentSession;
    this.isStopped = nextIsStopped;

    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }

    if (this.isStopped) {
      this._timeout = undefined;
      this._expiresAt = undefined;
      return;
    }

    const remainingTimeout =
      getRemainingTimeoutFromSession(currentSession) ??
      DEFAULT_RECONNECT_TIMEOUT_MS;
    this._timeout = remainingTimeout;
    this._expiresAt = Date.now() + remainingTimeout;
    this.scheduleProactiveStop();
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

    // Check if the current session supports timeout extension
    if (typeof this.session.extendTimeout !== "function") {
      throw new Error(
        "extendTimeout is not supported by this version of @vercel/sandbox",
      );
    }

    // Call Vercel SDK to extend the current session
    await this.session.extendTimeout(additionalMs);

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
      ? `\n- Dev server URLs for locally running servers (start a server on one of these ports, then share the URL with the user):\n${portPreviewLines.join("\n")}`
      : "";

    const hostLine = host ? `\n- Sandbox host: ${host}` : "";
    const runtimeEnvLine =
      host || previewPorts.length > 0
        ? "\n- Runtime env vars for dev server URLs are injected into commands: SANDBOX_HOST and SANDBOX_URL_<PORT> (for routable ports)"
        : "";

    return `- Sandbox VMs are temporary, but named sandboxes can be hibernated and later resumed from their persisted filesystem state
- All bash commands already run in the working directory by default — never prepend \`cd <working-directory> &&\`; just run the command directly
- Do NOT prefix any bash command with a \`cd\` to the working directory — commands like \`cd <working-directory> && npm test\` are WRONG; just use \`npm test\`
- Use workspace-relative paths for read/write/search/edit operations
- Git is already configured (user, email, remote auth) - no setup or verification needed
- GitHub CLI (gh) is NOT available - use curl with the GitHub API directly
  GitHub API and git HTTPS requests are authenticated automatically via credential brokering; do not pass tokens into commands.
  Example: curl -X POST -H "Accept: application/vnd.github+json" https://api.github.com/repos/OWNER/REPO/pulls -d '{"title":"...","head":"branch","base":"main","body":"..."}'
- Node.js runtime with npm/pnpm available
- Bun and jq are preinstalled
- Dependencies may not be installed. Before running project scripts (build, typecheck, lint, test), check if \`node_modules\` exists and run the package manager install command if needed (e.g. \`bun install\`, \`npm install\`)
- This snapshot includes agent-browser; when validating UI or end-to-end behavior, start the dev server and use agent-browser against the local dev server URL
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
   * Use `skipGitWorkspaceBootstrap` when preparing a new base snapshot so the workspace
   * stays free of `.git` for subsequent clones.
   */
  static async create(
    config: VercelSandboxConfig = {},
  ): Promise<VercelSandbox> {
    const {
      name,
      source,
      restoreSnapshotId,
      gitUser,
      env,
      githubToken,
      vcpus = 4,
      timeout = 300_000,
      runtime = "node22",
      ports,
      baseSnapshotId,
      persistent = true,
      snapshotExpiration,
      hooks,
      skipGitWorkspaceBootstrap = false,
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
      ...(name ? { name } : {}),
      resources: { vcpus },
      timeout: sdkTimeout,
      runtime,
      persistent,
      networkPolicy: buildGitHubCredentialBrokeringPolicy(githubToken),
      ...(ports && { ports }),
      ...(snapshotExpiration !== undefined && { snapshotExpiration }),
    };

    let sdk: VercelSandboxSDK;
    if (restoreSnapshotId) {
      sdk = await VercelSandboxSDK.create({
        ...createBaseConfig,
        source: { type: "snapshot", snapshotId: restoreSnapshotId },
      });
    } else if (baseSnapshotId) {
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
          `Failed to clone repository '${source.url}' (exit code ${cloneResult.exitCode})`,
        );
      }
    }

    // Initialize git repo for empty sandboxes (no source provided)
    // This ensures git commands work consistently (e.g., for diff viewing)
    if (!source && !restoreSnapshotId && !skipGitWorkspaceBootstrap) {
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

    // Configure git user for commits if provided (skip when no repo was created)
    if (gitUser && (source || !skipGitWorkspaceBootstrap)) {
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
    if (
      !source &&
      !restoreSnapshotId &&
      gitUser &&
      !skipGitWorkspaceBootstrap
    ) {
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

    // Capture startTime AFTER all setup operations so users get their full timeout duration.
    const startTime = Date.now();
    const session = sdk.currentSession();
    const sandbox = new VercelSandbox(
      sdk,
      session,
      sdk.name,
      session.sessionId,
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
   * Connect to an existing Vercel Sandbox by persistent name.
   */
  static async connect(
    sandboxName: string,
    options: {
      env?: Record<string, string>;
      githubToken?: string;
      hooks?: SandboxHooks;
      /**
       * Remaining timeout in ms for this sandbox session.
       * If not provided, it is derived from the live session metadata when possible.
       */
      remainingTimeout?: number;
      /** Ports that were declared at creation time (for preview URL display) */
      ports?: number[];
      /** Whether to explicitly resume a stopped sandbox */
      resume?: boolean;
    } = {},
  ): Promise<VercelSandbox> {
    const sdk = await VercelSandboxSDK.get({
      name: sandboxName,
      resume: options.resume ?? false,
    });
    await syncGitHubCredentialBrokering(sdk, options.githubToken);
    const session = sdk.currentSession();

    // Use provided remainingTimeout when available; otherwise derive it from the
    // current live session. Fall back to the default reconnect timeout so active
    // sessions still get proactive stop tracking even if metadata is missing.
    const remainingTimeout =
      options.remainingTimeout ??
      getRemainingTimeoutFromSession(session) ??
      (isStoppedSessionStatus(session.status)
        ? undefined
        : DEFAULT_RECONNECT_TIMEOUT_MS);
    const startTime = remainingTimeout !== undefined ? Date.now() : undefined;

    const sandbox = new VercelSandbox(
      sdk,
      session,
      sandboxName,
      session.sessionId,
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
    // Use the SDK's native readFileToBuffer method which handles streaming
    // internally, avoiding the command output size limit that can occur with
    // large files when using `cat` via runCommand.
    const buffer = await this.session.readFileToBuffer({ path });

    if (buffer === null) {
      throw new Error(`Failed to read file: ${path}`);
    }

    return buffer.toString("utf-8");
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

    // Use the SDK's native writeFiles method which handles streaming internally,
    // avoiding the command argument size limit that causes "Expected a stream of
    // command data" errors with large files when using runCommand + base64.
    await this.session.writeFiles([
      { path, content: Buffer.from(content, "utf-8") },
    ]);
  }

  async stat(path: string): Promise<SandboxStats> {
    // Use stat command to get file info
    // Use tab delimiter to avoid issues with file types containing spaces (e.g., "regular file")
    const result = await this.session.runCommand({
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
    const result = await this.session.runCommand({
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
    const result = await this.session.runCommand({
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
    const result = await this.session.runCommand({
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
    options?: { signal?: AbortSignal },
  ): Promise<ExecResult> {
    try {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal = options?.signal
        ? AbortSignal.any([timeoutSignal, options.signal])
        : timeoutSignal;

      const result = await this.session.runCommand({
        cmd: "bash",
        args: ["-c", `cd "${cwd}" && ${command}`],
        env: this.getCommandEnv(),
        signal,
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

      if (error instanceof Error && error.name === "AbortError") {
        throw error;
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
    const result = await this.session.runCommand({
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
    return this.session.domain(port);
  }

  /**
   * Create a native Vercel snapshot of the sandbox filesystem.
   * IMPORTANT: This automatically stops the sandbox after snapshot creation.
   */
  async snapshot(): Promise<SnapshotResult> {
    // Use the current session snapshot method to avoid implicitly resuming stopped sandboxes.
    const snapshot = await this.session.snapshot();

    // Mark sandbox as stopped since native snapshot stops it automatically
    this.isStopped = true;
    this._expiresAt = undefined;

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
    this._expiresAt = undefined;

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
    this.refreshStateFromCurrentSession();
    if (this.isStopped) return "stopped";
    return "ready";
  }

  /**
   * Get the current state for persistence.
   * Returns state that can be passed to `connectSandbox()` to restore this sandbox.
   */
  getState(): { type: "vercel" } & VercelState {
    this.refreshStateFromCurrentSession();
    return {
      type: "vercel",
      sandboxName: this.name,
      ...(this.expiresAt !== undefined ? { expiresAt: this.expiresAt } : {}),
    };
  }
}

/**
 * Connect to a Vercel Sandbox - either create a new one or reconnect to an existing one.
 *
 * @param config - Configuration options. Pass `sandboxName` to reconnect, or other options to create new.
 *
 * @example
 * // Start a named persistent sandbox
 * const sandbox = await connectVercelSandbox({ name: "session_123" });
 * console.log(sandbox.name); // "session_123"
 *
 * @example
 * // Reconnect to an existing sandbox without resuming it automatically
 * const sandbox = await connectVercelSandbox({
 *   sandboxName: "session_123",
 *   resume: false,
 * });
 *
 * @example
 * // Clone a repo into a new sandbox
 * const sandbox = await connectVercelSandbox({
 *   name: "session_123",
 *   source: {
 *     url: "https://github.com/owner/repo",
 *     branch: "develop",
 *   },
 * });
 */
export async function connectVercelSandbox(
  config: VercelSandboxConfig | VercelSandboxConnectConfig = {},
): Promise<VercelSandbox> {
  const connectConfig = config as VercelSandboxConnectConfig & {
    sandboxId?: string;
  };
  const sandboxName = connectConfig.sandboxName ?? connectConfig.sandboxId;

  if (sandboxName) {
    return VercelSandbox.connect(sandboxName, {
      env: connectConfig.env,
      githubToken: connectConfig.githubToken,
      hooks: connectConfig.hooks,
      remainingTimeout: connectConfig.remainingTimeout,
      ports: connectConfig.ports,
      resume: connectConfig.resume,
    });
  }

  return VercelSandbox.create(config as VercelSandboxConfig);
}
