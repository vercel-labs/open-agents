import type { SandboxState } from "@open-harness/sandbox";
import { SANDBOX_EXPIRES_BUFFER_MS } from "./config";

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasLocalRuntimeState(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/**
 * Type guard to check if a sandbox is active and ready to accept operations.
 *
 * "Active" means ALL of:
 * - state is a valid SandboxState (not null/undefined)
 * - sandbox has not expired (with 10s buffer for clock skew)
 * - sandbox has runtime state (sandboxId for cloud, runtime files for local)
 *
 * Use this for operations that require an active sandbox (chat, file ops, etc.)
 * For operations on potentially expired sandboxes (snapshot, stop), use canOperateOnSandbox.
 */
export function isSandboxActive(
  state: SandboxState | null | undefined,
): state is SandboxState {
  if (!state) return false;

  // Check expiration first (with 10s buffer for clock skew)
  if ("expiresAt" in state && state.expiresAt !== undefined) {
    if (Date.now() >= state.expiresAt - SANDBOX_EXPIRES_BUFFER_MS) {
      return false;
    }
  }

  return hasRuntimeState(state);
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
  return hasRuntimeState(state);
}

/**
 * Check if an unknown value (e.g. from DB jsonb) represents sandbox state
 * with runtime data (sandboxId for cloud, runtime files for local).
 *
 * Unlike the typed `hasRuntimeState`, this accepts `unknown` so callers
 * don't need to narrow to `SandboxState` first.
 */
export function hasRuntimeSandboxState(state: unknown): boolean {
  if (!state || typeof state !== "object") return false;

  const sandboxState = state as {
    sandboxId?: unknown;
    files?: unknown;
  };

  return (
    hasNonEmptyString(sandboxState.sandboxId) ||
    hasLocalRuntimeState(sandboxState.files)
  );
}

/**
 * Check if an error message indicates the sandbox VM is permanently
 * unavailable (stopped, not found, or stream closed).
 *
 * Use this to decide whether to clear sandbox runtime state in DB.
 * Transient errors (timeouts, network blips) should NOT match.
 */
export function isSandboxUnavailableError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("expected a stream of command data") ||
    normalized.includes("sandbox is stopped") ||
    normalized.includes("sandbox not found") ||
    normalized.includes("sandbox probe failed")
  );
}

/**
 * Check if the sandbox state has runtime state (active sandbox).
 * Used internally to determine if sandbox is currently running.
 */
function hasRuntimeState(state: SandboxState): boolean {
  return (
    ("sandboxId" in state && hasNonEmptyString(state.sandboxId)) ||
    ("files" in state && hasLocalRuntimeState(state.files))
  );
}

/**
 * Clear sandbox runtime state while preserving the type for future restoration.
 * Returns a minimal SandboxState with only the type field.
 */
export function clearSandboxState(
  state: SandboxState | null | undefined,
): SandboxState | null {
  if (!state) return null;

  return { type: state.type } as SandboxState;
}
