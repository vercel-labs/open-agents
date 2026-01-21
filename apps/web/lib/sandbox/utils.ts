import type { SandboxState } from "@open-harness/sandbox";

export function isSandboxActive(
  state: SandboxState | null | undefined,
): state is SandboxState {
  if (!state) return false;

  // Check expiration first (with 10s buffer for clock skew)
  if ("expiresAt" in state && state.expiresAt !== undefined) {
    if (Date.now() >= state.expiresAt - 10_000) {
      return false;
    }
  }

  switch (state.type) {
    case "vercel":
      return !!state.sandboxId;
    case "hybrid":
      return !!state.sandboxId || !!state.files;
    case "just-bash":
      return !!state.files;
    default:
      return false;
  }
}

/**
 * Check if we can perform operations on a sandbox (snapshot, stop, etc.).
 * Unlike isSandboxActive, this does NOT check expiration - we should still
 * be able to snapshot/stop an expired sandbox.
 */
export function canOperateOnSandbox(
  state: SandboxState | null | undefined,
): state is SandboxState {
  if (!state) return false;
  switch (state.type) {
    case "vercel":
      return !!state.sandboxId;
    case "hybrid":
      return !!state.sandboxId;
    case "just-bash":
      return !!state.files;
    default:
      return false;
  }
}

export function clearSandboxState(
  state: SandboxState | null | undefined,
): SandboxState | null {
  if (!state) return null;
  return { type: state.type } as SandboxState;
}
