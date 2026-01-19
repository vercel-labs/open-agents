# Sandbox Folder Restructure

**Status: Complete** (commit `b6af16f`)

Prerequisite task for the [Sandbox Abstraction Design](./sandbox-abstraction-design.md).

## Goal

Reorganize sandbox implementations from single files into self-contained folders, enabling cleaner separation between:
- **Sandbox class** (implements the `Sandbox` interface)
- **Connect function** (state-based creation/restoration)
- **Config/State types** (implementation-specific)

## Current Structure

```
packages/sandbox/
  interface.ts      # Sandbox interface + shared types
  local.ts          # LocalSandbox (145 lines)
  vercel.ts         # VercelSandbox (856 lines)
  just-bash.ts      # JustBashSandbox (481 lines)
  index.ts          # Package exports
```

## Target Structure

```
packages/sandbox/
  interface.ts          # Sandbox interface (unchanged)
  types.ts              # NEW: Shared primitives (Source, FileEntry, etc.)

  local/
    index.ts            # Re-exports
    sandbox.ts          # LocalSandbox class

  vercel/
    index.ts            # Re-exports
    sandbox.ts          # VercelSandbox class
    config.ts           # VercelSandboxConfig, VercelSandboxConnectConfig

  just-bash/
    index.ts            # Re-exports
    sandbox.ts          # JustBashSandbox class
    snapshot.ts         # JustBashSnapshot type + serialization

  index.ts              # Package exports (updated paths)
```

Note: `connect.ts` files will be added in the abstraction layer task, not this restructure.

## Steps

### 1. Create shared types file

Extract reusable types that will be shared across implementations:

```typescript
// types.ts
export interface Source {
  repo: string;
  branch?: string;
  token?: string;
}

export interface FileEntry {
  type: "file" | "directory" | "symlink";
  content?: string;
  encoding?: "base64";
  mode?: number;
  target?: string;
}

export type PendingOperation =
  | { type: "writeFile"; path: string; content: string }
  | { type: "mkdir"; path: string; recursive: boolean };
```

### 2. Restructure local/

```bash
mkdir -p packages/sandbox/local
```

**local/sandbox.ts**: Move `LocalSandbox` class from `local.ts`

**local/index.ts**:
```typescript
export { LocalSandbox, createLocalSandbox } from "./sandbox.js";
```

### 3. Restructure vercel/

```bash
mkdir -p packages/sandbox/vercel
```

**vercel/sandbox.ts**: Move `VercelSandbox` class from `vercel.ts`

**vercel/config.ts**: Extract config types
```typescript
export interface VercelSandboxConfig { /* ... */ }
export interface VercelSandboxConnectConfig { /* ... */ }
```

**vercel/index.ts**:
```typescript
export { VercelSandbox, connectVercelSandbox } from "./sandbox.js";
export type { VercelSandboxConfig, VercelSandboxConnectConfig } from "./config.js";
```

### 4. Restructure just-bash/

```bash
mkdir -p packages/sandbox/just-bash
```

**just-bash/sandbox.ts**: Move `JustBashSandbox` class from `just-bash.ts`

**just-bash/snapshot.ts**: Extract snapshot types
```typescript
export interface JustBashSnapshot {
  workingDirectory: string;
  env: Record<string, string>;
  files: Record<string, FileEntry>;
}
```

**just-bash/index.ts**:
```typescript
export { JustBashSandbox, createJustBashSandbox } from "./sandbox.js";
export type { JustBashSandboxConfig } from "./sandbox.js";
export type { JustBashSnapshot } from "./snapshot.js";
```

### 5. Update package index.ts

```typescript
// interface
export type {
  Sandbox,
  SandboxStats,
  ExecResult,
  SandboxHook,
  SandboxHooks,
  SnapshotOptions,
  SnapshotResult,
  RestoreOptions,
} from "./interface.js";

// shared types
export type { Source, FileEntry, PendingOperation } from "./types.js";

// local
export { LocalSandbox, createLocalSandbox } from "./local/index.js";

// vercel
export {
  VercelSandbox,
  connectVercelSandbox,
  type VercelSandboxConfig,
  type VercelSandboxConnectConfig,
} from "./vercel/index.js";

// just-bash
export {
  JustBashSandbox,
  createJustBashSandbox,
  type JustBashSandboxConfig,
  type JustBashSnapshot,
} from "./just-bash/index.js";
```

### 6. Delete old files

```bash
rm packages/sandbox/local.ts
rm packages/sandbox/vercel.ts
rm packages/sandbox/just-bash.ts
```

### 7. Verify

```bash
turbo typecheck --filter=@open-harness/sandbox
turbo typecheck  # Full monorepo check
```

## Migration Notes

- **No functionality changes** - this is purely organizational
- **Export paths unchanged** - consumers still import from `@open-harness/sandbox`
- **Types stay in place** - config types move to dedicated files but remain exported

## After This Task

The [Sandbox Abstraction Design](./sandbox-abstraction-design.md) can proceed with:
- Adding `connect.ts` to each folder (state types + connect functions)
- Adding `factory.ts` at package root (SandboxState union + connectSandbox dispatcher)
- Adding `getState()` method to Sandbox interface
