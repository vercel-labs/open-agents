import { APIClient } from "@vercel/sandbox/dist/api-client";
import { getCredentials } from "@vercel/sandbox/dist/utils/get-credentials";
import type { Dirent } from "fs";
import type { ExecResult, Sandbox, SandboxStats } from "../interface";
import {
  accessDirect,
  execDetachedDirect,
  execDirect,
  mkdirDirect,
  readFileDirect,
  readdirDirect,
  statDirect,
  writeFileDirect,
} from "./direct-operations";
import type { VercelState } from "./state";

const DEFAULT_WORKING_DIRECTORY = "/vercel/sandbox";

const NON_RECONNECTABLE_ERROR_PREFIXES = [
  "ENOENT:",
  "Failed to create directory:",
  "Failed to read file:",
  "Background command exited with code",
  "Detached execution is not supported by this sandbox",
] as const;

/** Re-fetch credentials after this interval to handle token rotation. */
const API_CLIENT_TTL_MS = 30 * 60 * 1000; // 30 minutes

let sharedApiClientPromise: Promise<APIClient | null> | null = null;
let sharedApiClientCreatedAt = 0;

function isDirectSandboxConnectionDisabled(): boolean {
  return process.env.OPEN_HARNESS_SANDBOX_REST === "0";
}

async function getSharedApiClient(): Promise<APIClient | null> {
  if (isDirectSandboxConnectionDisabled()) {
    return null;
  }

  if (
    sharedApiClientPromise &&
    Date.now() - sharedApiClientCreatedAt > API_CLIENT_TTL_MS
  ) {
    sharedApiClientPromise = null;
  }

  if (!sharedApiClientPromise) {
    sharedApiClientCreatedAt = Date.now();
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

function isSandboxUnavailableMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("expected a stream of command data") ||
    (normalized.includes("sandbox") && normalized.includes("not found")) ||
    (normalized.includes("sandbox") && normalized.includes("stopped"))
  );
}

function shouldReconnectAfterDirectError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return true;
  }

  if (
    NON_RECONNECTABLE_ERROR_PREFIXES.some((prefix) =>
      error.message.startsWith(prefix),
    )
  ) {
    return false;
  }

  return true;
}

function shouldReconnectAfterExecResult(result: ExecResult): boolean {
  if (result.success) {
    return false;
  }

  const combinedOutput = `${result.stderr}\n${result.stdout}`.trim();
  if (!combinedOutput) {
    return false;
  }

  return isSandboxUnavailableMessage(combinedOutput);
}

interface SandboxRoute {
  url: string;
  port: number;
}

class VercelDirectSandbox implements Sandbox {
  readonly type = "cloud" as const;
  readonly currentBranch = undefined;
  readonly hooks = undefined;

  readonly workingDirectory: string;
  readonly env?: Record<string, string>;

  private readonly client: APIClient;
  private readonly sandboxId: string;
  private readonly reconnect?: () => Promise<Sandbox>;
  private readonly persistedExpiresAt?: number;

  private fallbackSandbox: Sandbox | null = null;
  private fallbackSandboxPromise: Promise<Sandbox> | null = null;

  /** Routes discovered via background getSandbox call. */
  private routes: SandboxRoute[] | null = null;

  constructor(params: {
    client: APIClient;
    sandboxId: string;
    workingDirectory: string;
    env?: Record<string, string>;
    reconnect?: () => Promise<Sandbox>;
    expiresAt?: number;
  }) {
    this.client = params.client;
    this.sandboxId = params.sandboxId;
    this.workingDirectory = params.workingDirectory;
    this.env = params.env;
    this.reconnect = params.reconnect;
    this.persistedExpiresAt = params.expiresAt;

    // Fire-and-forget: fetch sandbox metadata to discover routes for env var
    // injection (SANDBOX_HOST, SANDBOX_URL_<PORT>). This runs in the
    // background so it doesn't block the optimistic fast path.
    this.client
      .getSandbox({ sandboxId: this.sandboxId })
      .then((info) => {
        if (!this.fallbackSandbox && info.json.routes.length > 0) {
          this.routes = info.json.routes.map((r) => ({
            url: r.url,
            port: r.port,
          }));
        }
      })
      .catch(() => {
        // Ignore — route env vars will be unavailable on the direct path.
        // The full SDK reconnect path provides them as a fallback.
      });
  }

  /**
   * Build command env vars by merging caller-provided env with runtime preview
   * env vars discovered from sandbox routes.
   */
  private getCommandEnv(): Record<string, string> | undefined {
    const runtimeEnv: Record<string, string> = {};

    if (this.routes) {
      for (const route of this.routes) {
        try {
          const host = new URL(route.url).host;
          if (host && !runtimeEnv.SANDBOX_HOST) {
            runtimeEnv.SANDBOX_HOST = host;
          }
          runtimeEnv[`SANDBOX_URL_${route.port}`] = route.url;
        } catch {
          // Skip malformed URLs
        }
      }
    }

    if (!this.env && Object.keys(runtimeEnv).length === 0) {
      return undefined;
    }

    return {
      ...this.env,
      ...runtimeEnv,
    };
  }

  get environmentDetails(): string | undefined {
    return this.fallbackSandbox?.environmentDetails;
  }

  get host(): string | undefined {
    if (this.fallbackSandbox?.host) {
      return this.fallbackSandbox.host;
    }
    const firstRoute = this.routes?.[0];
    if (firstRoute) {
      try {
        return new URL(firstRoute.url).host;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  get expiresAt(): number | undefined {
    return this.fallbackSandbox?.expiresAt ?? this.persistedExpiresAt;
  }

  get timeout(): number | undefined {
    return this.fallbackSandbox?.timeout;
  }

  private async reconnectToManagedSandbox(): Promise<Sandbox> {
    if (this.fallbackSandbox) {
      return this.fallbackSandbox;
    }

    const reconnect = this.reconnect;
    if (!reconnect) {
      throw new Error("Reconnect is not configured for this sandbox instance");
    }

    if (!this.fallbackSandboxPromise) {
      this.fallbackSandboxPromise = (async () => {
        const sandbox = await reconnect();
        this.fallbackSandbox = sandbox;
        return sandbox;
      })();
    }

    try {
      return await this.fallbackSandboxPromise;
    } catch (error) {
      this.fallbackSandboxPromise = null;
      throw error;
    }
  }

  private async runWithReconnect<T>(params: {
    runDirect: () => Promise<T>;
    runFallback: (sandbox: Sandbox) => Promise<T>;
  }): Promise<T> {
    if (this.fallbackSandbox) {
      return params.runFallback(this.fallbackSandbox);
    }

    try {
      return await params.runDirect();
    } catch (error) {
      if (!this.reconnect || !shouldReconnectAfterDirectError(error)) {
        throw error;
      }

      const sandbox = await this.reconnectToManagedSandbox();
      return params.runFallback(sandbox);
    }
  }

  async readFile(path: string, encoding: "utf-8"): Promise<string> {
    return this.runWithReconnect({
      runDirect: () => readFileDirect(this.client, this.sandboxId, path),
      runFallback: (sandbox) => sandbox.readFile(path, encoding),
    });
  }

  async writeFile(
    path: string,
    content: string,
    encoding: "utf-8",
  ): Promise<void> {
    await this.runWithReconnect({
      runDirect: () =>
        writeFileDirect({
          client: this.client,
          sandboxId: this.sandboxId,
          workingDirectory: this.workingDirectory,
          path,
          content,
        }),
      runFallback: (sandbox) => sandbox.writeFile(path, content, encoding),
    });
  }

  async stat(path: string): Promise<SandboxStats> {
    return this.runWithReconnect({
      runDirect: () =>
        statDirect({
          client: this.client,
          sandboxId: this.sandboxId,
          workingDirectory: this.workingDirectory,
          env: this.env,
          path,
        }),
      runFallback: (sandbox) => sandbox.stat(path),
    });
  }

  async access(path: string): Promise<void> {
    await this.runWithReconnect({
      runDirect: () =>
        accessDirect({
          client: this.client,
          sandboxId: this.sandboxId,
          workingDirectory: this.workingDirectory,
          env: this.env,
          path,
        }),
      runFallback: (sandbox) => sandbox.access(path),
    });
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.runWithReconnect({
      runDirect: () =>
        mkdirDirect({
          client: this.client,
          sandboxId: this.sandboxId,
          workingDirectory: this.workingDirectory,
          env: this.env,
          path,
          options,
        }),
      runFallback: (sandbox) => sandbox.mkdir(path, options),
    });
  }

  async readdir(
    path: string,
    options: { withFileTypes: true },
  ): Promise<Dirent[]> {
    return this.runWithReconnect({
      runDirect: () =>
        readdirDirect({
          client: this.client,
          sandboxId: this.sandboxId,
          workingDirectory: this.workingDirectory,
          env: this.env,
          path,
        }),
      runFallback: (sandbox) => sandbox.readdir(path, options),
    });
  }

  async exec(
    command: string,
    cwd: string,
    timeoutMs: number,
  ): Promise<ExecResult> {
    if (this.fallbackSandbox) {
      return this.fallbackSandbox.exec(command, cwd, timeoutMs);
    }

    const result = await execDirect({
      client: this.client,
      sandboxId: this.sandboxId,
      command,
      cwd,
      timeoutMs,
      env: this.getCommandEnv(),
    });

    if (!this.reconnect || !shouldReconnectAfterExecResult(result)) {
      return result;
    }

    const sandbox = await this.reconnectToManagedSandbox();
    return sandbox.exec(command, cwd, timeoutMs);
  }

  async execDetached(
    command: string,
    cwd: string,
  ): Promise<{ commandId: string }> {
    return this.runWithReconnect({
      runDirect: () =>
        execDetachedDirect({
          client: this.client,
          sandboxId: this.sandboxId,
          command,
          cwd,
          env: this.getCommandEnv(),
        }),
      runFallback: async (sandbox) => {
        if (!sandbox.execDetached) {
          throw new Error(
            "Detached execution is not supported by this sandbox",
          );
        }
        return sandbox.execDetached(command, cwd);
      },
    });
  }

  async stop(): Promise<void> {
    if (this.fallbackSandbox) {
      await this.fallbackSandbox.stop();
      return;
    }

    await this.client.stopSandbox({ sandboxId: this.sandboxId });
  }

  async extendTimeout(additionalMs: number): Promise<{ expiresAt: number }> {
    const sandbox = await this.reconnectToManagedSandbox();
    if (!sandbox.extendTimeout) {
      throw new Error("Extend timeout is not supported by this sandbox");
    }
    return sandbox.extendTimeout(additionalMs);
  }

  async snapshot(): Promise<{ snapshotId: string }> {
    const sandbox = await this.reconnectToManagedSandbox();
    if (!sandbox.snapshot) {
      throw new Error("Snapshot is not supported by this sandbox");
    }
    return sandbox.snapshot();
  }

  getState(): { type: "vercel" } & VercelState {
    if (this.fallbackSandbox?.getState) {
      const fallbackState = this.fallbackSandbox.getState();
      if (fallbackState && typeof fallbackState === "object") {
        return fallbackState as { type: "vercel" } & VercelState;
      }
    }

    const expiresAt = this.expiresAt;
    return {
      type: "vercel",
      sandboxId: this.sandboxId,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    };
  }
}

interface DirectConnectOptions {
  sandboxId: string;
  workingDirectory?: string;
  env?: Record<string, string>;
  reconnect?: () => Promise<Sandbox>;
  expiresAt?: number;
}

/**
 * Attempt to create an optimistic sandbox adapter backed by the Vercel REST API.
 *
 * This skips the initial SDK reconnect handshake and assumes the sandbox is
 * already running. Returns null when credentials are not available so callers
 * can fall back to standard connect logic.
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
    reconnect: options.reconnect,
    expiresAt: options.expiresAt,
  });
}
