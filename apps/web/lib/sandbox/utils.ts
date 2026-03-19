import type { SandboxState } from "@open-harness/sandbox";
import { SANDBOX_EXPIRES_BUFFER_MS } from "./config";

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Type guard to check if a sandbox is active and ready to accept operations.
 */
export function isSandboxActive(
  state: SandboxState | null | undefined,
): state is SandboxState {
  if (!state) return false;

  if ("expiresAt" in state && state.expiresAt !== undefined) {
    if (Date.now() >= state.expiresAt - SANDBOX_EXPIRES_BUFFER_MS) {
      return false;
    }
  }

  return hasRuntimeState(state);
}

/**
 * Check if we can perform operations on a sandbox (snapshot, stop, etc.).
 */
export function canOperateOnSandbox(
  state: SandboxState | null | undefined,
): state is SandboxState {
  if (!state) return false;
  return hasRuntimeState(state);
}

/**
 * Check if an unknown value represents sandbox state with runtime data.
 */
export function hasRuntimeSandboxState(state: unknown): boolean {
  if (!state || typeof state !== "object") return false;

  const sandboxState = state as {
    sandboxId?: unknown;
  };

  return hasNonEmptyString(sandboxState.sandboxId);
}

/**
 * Check if an error message indicates the sandbox VM is permanently unavailable.
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

function hasRuntimeState(state: SandboxState): boolean {
  return "sandboxId" in state && hasNonEmptyString(state.sandboxId);
}

/**
 * Clear sandbox runtime state while preserving the type for future restoration.
 */
export function clearSandboxState(
  state: SandboxState | null | undefined,
): SandboxState | null {
  if (!state) return null;

  return { type: state.type } as SandboxState;
}
