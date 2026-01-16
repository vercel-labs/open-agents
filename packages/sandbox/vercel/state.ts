import type { Source } from "../types";

/**
 * State configuration for creating, reconnecting, or restoring a Vercel sandbox.
 * Used with the unified `connectSandbox()` API.
 */
export interface VercelState {
  /** Where to clone from (omit for empty sandbox or when reconnecting/restoring) */
  source?: Source;
  /** Sandbox ID for reconnecting to a running VM (omit for fresh start) */
  sandboxId?: string;
  /** Snapshot ID for restoring when VM timed out (sandboxId will be undefined) */
  snapshotId?: string;
}
