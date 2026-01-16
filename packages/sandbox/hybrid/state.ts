import type { Source, FileEntry, PendingOperation } from "../types";

/**
 * State configuration for hybrid sandbox.
 *
 * The hybrid sandbox starts with an ephemeral component (JustBash) and
 * transitions to a persistent cloud component when ready.
 *
 * Used with the unified `connectSandbox()` API.
 */
export interface HybridState {
  // === Ephemeral component (JustBash) ===

  /**
   * File state for JustBash (client provides, extracted from tarball).
   * Present when in pre-handoff ephemeral phase.
   * Note: This is the file content, NOT a URL to download from.
   */
  files?: Record<string, FileEntry>;

  /** Working directory path */
  workingDirectory?: string;

  /** Environment variables */
  env?: Record<string, string>;

  // === Cloud component ===

  /**
   * Source for cloud sandbox cloning.
   * Note: This is used for cloud sandbox initialization, NOT for tarball download.
   * The client is responsible for downloading tarballs and providing `files`.
   */
  source?: Source;

  /**
   * Cloud sandbox ID (present once cloud sandbox is running).
   * When present with files, indicates cloud is ready for inline handoff.
   * When present without files, indicates post-handoff state.
   */
  sandboxId?: string;

  /** Snapshot ID for restoring when cloud sandbox timed out */
  snapshotId?: string;

  // === Handoff ===

  /**
   * Operations to replay on handoff (present pre-handoff).
   * These are tracked during ephemeral phase and replayed to cloud on handoff.
   */
  pendingOperations?: PendingOperation[];
}
