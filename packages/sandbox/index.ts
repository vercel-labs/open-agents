// interface
export type {
  ExecResult,
  RestoreOptions,
  Sandbox,
  SandboxHook,
  SandboxHooks,
  SandboxStats,
  SandboxType,
  SnapshotOptions,
  SnapshotResult,
} from "./interface";

// shared types
export type {
  Source,
  FileEntry,
  PendingOperation,
  SandboxStatus,
} from "./types";

// factory
export {
  connectSandbox,
  type SandboxState,
  type ConnectOptions,
  type HybridConnectOptions,
  type SandboxConnectConfig,
} from "./factory";

// local
export { LocalSandbox, createLocalSandbox } from "./local";

// vercel
export {
  connectVercelSandbox,
  VercelSandbox,
  type VercelSandboxConfig,
  type VercelSandboxConnectConfig,
  type VercelState,
} from "./vercel";

// just-bash
export {
  JustBashSandbox,
  createJustBashSandbox,
  type JustBashSandboxConfig,
  type JustBashSnapshot,
  type JustBashState,
} from "./just-bash";

// hybrid
export {
  HybridSandbox,
  requiresVercel,
  type HybridSandboxConfig,
  type HybridState,
  type HybridHooks,
} from "./hybrid";
