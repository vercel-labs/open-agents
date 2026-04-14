import type { Sandbox, SandboxHooks } from "../interface";
import type { VercelSandboxConfig } from "./config";
import { VercelSandbox } from "./sandbox";
import type { VercelState } from "./state";

interface ConnectOptions {
  env?: Record<string, string>;
  githubToken?: string;
  gitUser?: { name: string; email: string };
  hooks?: SandboxHooks;
  timeout?: number;
  ports?: number[];
  baseSnapshotId?: string;
  resume?: boolean;
  createIfMissing?: boolean;
  persistent?: boolean;
  snapshotExpiration?: number;
  skipGitWorkspaceBootstrap?: boolean;
}

function getRemainingTimeout(
  expiresAt: number | undefined,
): number | undefined {
  if (!expiresAt) {
    return undefined;
  }

  const remaining = expiresAt - Date.now();
  return remaining > 10_000 ? remaining : undefined;
}

function getSandboxName(state: VercelState): string | undefined {
  if (typeof state.sandboxName === "string" && state.sandboxName.length > 0) {
    return state.sandboxName;
  }

  if (typeof state.sandboxId === "string" && state.sandboxId.length > 0) {
    return state.sandboxId;
  }

  return undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isSandboxNotFoundError(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  return message.includes("status code 404") || message.includes("not found");
}

function buildCreateConfig(
  state: VercelState,
  options?: ConnectOptions,
): VercelSandboxConfig {
  const sandboxName = getSandboxName(state);

  return {
    ...(sandboxName ? { name: sandboxName } : {}),
    ...(state.source
      ? {
          source: {
            url: state.source.repo,
            branch: state.source.branch,
            token: state.source.token,
            newBranch: state.source.newBranch,
          },
        }
      : {}),
    ...(state.snapshotId ? { restoreSnapshotId: state.snapshotId } : {}),
    env: options?.env,
    githubToken: options?.githubToken,
    gitUser: options?.gitUser,
    hooks: options?.hooks,
    ...(options?.timeout !== undefined && { timeout: options.timeout }),
    ...(options?.ports && { ports: options.ports }),
    ...(options?.baseSnapshotId && {
      baseSnapshotId: options.baseSnapshotId,
    }),
    ...(options?.persistent !== undefined && {
      persistent: options.persistent,
    }),
    ...(options?.snapshotExpiration !== undefined && {
      snapshotExpiration: options.snapshotExpiration,
    }),
    ...(options?.skipGitWorkspaceBootstrap && {
      skipGitWorkspaceBootstrap: true,
    }),
  };
}

async function connectNamedSandbox(
  state: VercelState,
  options?: ConnectOptions,
): Promise<Sandbox> {
  const sandboxName = getSandboxName(state);
  if (!sandboxName) {
    throw new Error("Persistent sandbox name is required");
  }

  const remainingTimeout = getRemainingTimeout(state.expiresAt);

  try {
    return await VercelSandbox.connect(sandboxName, {
      env: options?.env,
      githubToken: options?.githubToken,
      hooks: options?.hooks,
      remainingTimeout,
      ports: options?.ports,
      resume: options?.resume,
    });
  } catch (error) {
    if (!options?.createIfMissing || !isSandboxNotFoundError(error)) {
      throw error;
    }
  }

  return VercelSandbox.create(buildCreateConfig(state, options));
}

/**
 * Connect to the Vercel-backed cloud sandbox based on the provided state.
 *
 * - If `sandboxName` is present, reconnects to the named persistent sandbox
 * - If `snapshotId` is present without `sandboxName`, restores from a legacy snapshot
 * - If `source` is present, creates a new sandbox and prepares the repo
 * - Otherwise, creates an empty sandbox
 */
export async function connectVercel(
  state: VercelState,
  options?: ConnectOptions,
): Promise<Sandbox> {
  const sandboxName = getSandboxName(state);

  if (sandboxName) {
    return connectNamedSandbox(state, options);
  }

  return VercelSandbox.create(buildCreateConfig(state, options));
}
