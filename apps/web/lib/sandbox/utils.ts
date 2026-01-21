import type { SandboxState } from "@open-harness/sandbox";

export function isSandboxActive(
  state: SandboxState | null | undefined,
): state is SandboxState {
  if (!state) return false;
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

export function clearSandboxState(
  state: SandboxState | null | undefined,
): SandboxState | null {
  if (!state) return null;
  return { type: state.type } as SandboxState;
}
