import type { Sandbox, SandboxHooks } from "../interface";
import { VercelSandbox } from "./sandbox";
import type { VercelState } from "./state";

interface ConnectOptions {
  env?: Record<string, string>;
  gitUser?: { name: string; email: string };
  hooks?: SandboxHooks;
  timeout?: number;
  ports?: number[];
  baseSnapshotId?: string;
  skipGitWorkspaceBootstrap?: boolean;
  resume?: boolean;
  persistent?: boolean;
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
  return state.sandboxName ?? state.sandboxId;
}

function shouldReconnectPersistentSandbox(
  state: VercelState,
  options: ConnectOptions | undefined,
  sandboxName: string | undefined,
): sandboxName is string {
  if (!sandboxName) {
    return false;
  }

  if (options?.resume) {
    return true;
  }

  if (state.expiresAt !== undefined) {
    return true;
  }

  if (state.sandboxId !== undefined && state.sandboxName === undefined) {
    return true;
  }

  return false;
}

/**
 * Connect to the Vercel-backed cloud sandbox based on the provided state.
 *
 * - If `snapshotId` is present, creates a new named persistent sandbox from that legacy snapshot
 * - If `source`, `baseSnapshotId`, or `skipGitWorkspaceBootstrap` are present, creates a new named sandbox
 * - If `sandboxName` represents an active or explicitly resumed sandbox, reconnects to it
 * - Otherwise, creates an empty sandbox
 */
export async function connectVercel(
  state: VercelState,
  options?: ConnectOptions,
): Promise<Sandbox> {
  const sandboxName = getSandboxName(state);

  // Legacy snapshot restore/migration
  if (state.snapshotId) {
    return VercelSandbox.create({
      ...(sandboxName ? { name: sandboxName } : {}),
      env: options?.env,
      gitUser: options?.gitUser,
      hooks: options?.hooks,
      ...(options?.timeout !== undefined && { timeout: options.timeout }),
      ...(options?.ports && { ports: options.ports }),
      baseSnapshotId: state.snapshotId,
      persistent: options?.persistent ?? true,
    });
  }

  // Create from source
  if (state.source) {
    return VercelSandbox.create({
      ...(sandboxName ? { name: sandboxName } : {}),
      source: {
        url: state.source.repo,
        branch: state.source.branch,
        token: state.source.token,
        newBranch: state.source.newBranch,
      },
      env: options?.env,
      gitUser: options?.gitUser,
      hooks: options?.hooks,
      ...(options?.timeout !== undefined && { timeout: options.timeout }),
      ...(options?.ports && { ports: options.ports }),
      ...(options?.baseSnapshotId && {
        baseSnapshotId: options.baseSnapshotId,
      }),
      ...(options?.skipGitWorkspaceBootstrap && {
        skipGitWorkspaceBootstrap: true,
      }),
      persistent: options?.persistent ?? true,
    });
  }

  // Reconnect/resume an existing persistent sandbox
  if (shouldReconnectPersistentSandbox(state, options, sandboxName)) {
    const remainingTimeout =
      getRemainingTimeout(state.expiresAt) ?? options?.timeout;

    return VercelSandbox.connect(sandboxName, {
      env: options?.env,
      hooks: options?.hooks,
      remainingTimeout,
      ports: options?.ports,
      resume: options?.resume,
    });
  }

  // Create empty sandbox
  return VercelSandbox.create({
    ...(sandboxName ? { name: sandboxName } : {}),
    env: options?.env,
    gitUser: options?.gitUser,
    hooks: options?.hooks,
    ...(options?.timeout !== undefined && { timeout: options.timeout }),
    ...(options?.ports && { ports: options.ports }),
    ...(options?.baseSnapshotId && {
      baseSnapshotId: options.baseSnapshotId,
    }),
    ...(options?.skipGitWorkspaceBootstrap && {
      skipGitWorkspaceBootstrap: true,
    }),
    persistent: options?.persistent ?? true,
  });
}
