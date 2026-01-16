import type { Source, FileEntry, PendingOperation } from "../types";

/**
 * State configuration for creating, restoring, or reconnecting a Hybrid sandbox.
 * Hybrid sandboxes start ephemeral (JustBash) and transition to persistent (Vercel).
 * Used with the unified `connectSandbox()` API.
 */
export interface HybridState {
  /** Where to clone from (needed for fresh start or if Vercel not started yet) */
  source?: Source;
  /** JustBash file state (present when in ephemeral phase) */
  files?: Record<string, FileEntry>;
  /** Working directory path */
  workingDirectory?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Vercel sandbox ID (present once Vercel has started) */
  sandboxId?: string;
  /** Snapshot ID for restoring when VM timed out (sandboxId will be undefined) */
  snapshotId?: string;
  /** Operations to replay on handoff (present pre-handoff) */
  pendingOperations?: PendingOperation[];
}
