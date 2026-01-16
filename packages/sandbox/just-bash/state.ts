import type { Source, FileEntry } from "../types";

/**
 * State configuration for creating or restoring a JustBash sandbox.
 * Used with the unified `connectSandbox()` API.
 */
export interface JustBashState {
  /** Where to clone from (omit for empty sandbox or when restoring from files) */
  source?: Source;
  /** File state for restoration (omit for fresh start) */
  files?: Record<string, FileEntry>;
  /** Working directory path */
  workingDirectory?: string;
  /** Environment variables */
  env?: Record<string, string>;
}
