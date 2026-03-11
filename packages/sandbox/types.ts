/**
 * Source configuration for cloning a git repository into a sandbox.
 */
export interface Source {
  /** GitHub repository URL (e.g., "https://github.com/owner/repo") */
  repo: string;
  /** Branch to clone (defaults to "main") */
  branch?: string;
  /** Token for authenticated git access (e.g., GitHub PAT). Enables push operations. */
  token?: string;
  /** If set, create and checkout a new branch with this name after cloning */
  newBranch?: string;
}

/**
 * File entry representing a file, directory, or symlink in the sandbox filesystem.
 * Used for serialization/deserialization of sandbox state.
 */
export interface FileEntry {
  type: "file" | "directory" | "symlink";
  /** File content (UTF-8 text or base64 for binary) */
  content?: string;
  /** Set to "base64" for binary files */
  encoding?: "base64";
  /** File permissions */
  mode?: number;
  /** Symlink target path */
  target?: string;
}

/**
 * Status of a sandbox throughout its lifecycle.
 * Used for UI feedback and state management.
 */
export type SandboxStatus =
  | "starting" // Creating new sandbox
  | "restoring" // Restoring from saved state (files or snapshot)
  | "reconnecting" // Reconnecting to existing VM
  | "ready" // Fully usable
  | "stopping" // Shutting down
  | "stopped"; // Terminated
