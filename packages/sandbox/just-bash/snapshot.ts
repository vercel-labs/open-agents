import type { FileEntry } from "../types";

/**
 * Snapshot format for persisting JustBash state across serverless invocations.
 *
 * Only files under the working directory are included - system files
 * (`/bin`, `/proc`, `/dev`, `/usr`) are recreated automatically by JustBash.
 */
export interface JustBashSnapshot {
  workingDirectory: string;
  env: Record<string, string>;
  files: Record<string, FileEntry>;
}
