import type { SandboxHooks } from "../interface";
import type { JustBashState } from "./state";
import type { JustBashSnapshot } from "./snapshot";
import { JustBashSandbox } from "./sandbox";

const DEFAULT_WORKING_DIRECTORY = "/workspace";

interface ConnectOptions {
  env?: Record<string, string>;
  hooks?: SandboxHooks;
}

/**
 * Connect to a JustBash sandbox based on the provided state.
 *
 * - If `files` is present, restores from the file state
 * - Otherwise, creates an empty sandbox
 *
 * Note: JustBash does not support cloning from a source URL.
 * The `source` field is ignored by this implementation.
 */
export async function connectJustBash(
  state: JustBashState,
  options?: ConnectOptions,
): Promise<JustBashSandbox> {
  const workingDirectory = state.workingDirectory ?? DEFAULT_WORKING_DIRECTORY;
  // Merge env from state and options (options takes precedence)
  const env = { ...state.env, ...options?.env };

  // If we have files, restore from them
  if (state.files && Object.keys(state.files).length > 0) {
    const snapshot: JustBashSnapshot = {
      workingDirectory,
      env,
      files: state.files,
    };
    return JustBashSandbox.fromSnapshot(snapshot, options?.hooks);
  }

  // Create empty sandbox
  return JustBashSandbox.create({
    workingDirectory,
    env,
    mode: "memory",
    hooks: options?.hooks,
  });
}
