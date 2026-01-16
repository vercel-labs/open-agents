# Sandbox Abstraction Design

This document outlines how to create a unified sandbox interface that any consumer (web app, CLI, Slack bot, etc.) can use without knowing implementation details.

## Core Principle

**One function to rule them all**: `connectSandbox(state)`

Whether you're creating a fresh sandbox or restoring from saved state, it's the same operation. The state shape determines what happens internally.

The consumer should only care about:
- **Get** - obtain a sandbox (fresh, restored, or reconnected - same function)
- **Use** - read/write files, execute commands
- **Get State** - for persistence
- **Close** - shut it down

Everything else (timeouts, hybrid transitions, handoff logic) is internal to the sandbox implementation.

---

## Current Sandbox Implementations

### JustBash (Ephemeral/In-Memory)

Location: `packages/sandbox/just-bash.ts`

**Characteristics**:
- Pure in-memory filesystem
- No real bash process - simulated
- No network, no git
- Needs full file state every time it's created

**Current API**:
```typescript
// Create
const sandbox = await createJustBashSandbox({
  workingDirectory: "/workspace",
  files: { "/workspace/file.txt": "content" },
  mode: "memory",
});

// Serialize for persistence
const snapshot: JustBashSnapshot = sandbox.serialize();

// Restore from state
const sandbox = await JustBashSandbox.fromSnapshot(snapshot);
```

**State format** (`JustBashSnapshot`):
```typescript
interface JustBashSnapshot {
  workingDirectory: string;
  env: Record<string, string>;
  files: Record<string, {
    type: "file" | "directory" | "symlink";
    content?: string;
    encoding?: "base64";
    mode?: number;
    target?: string;
  }>;
}
```

### Vercel (Cloud-Native)

Location: `packages/sandbox/vercel.ts`

**Characteristics**:
- Firecracker MicroVM via `@vercel/sandbox` SDK
- Full bash, git, network, npm
- VM persists - can reconnect by ID
- Has timeout management

**Current API**:
```typescript
// Create new
const sandbox = await connectVercelSandbox({
  source: { url: "https://github.com/owner/repo", branch: "main" },
  timeout: 300_000,
});

// Reconnect to existing by ID
const sandbox = await connectVercelSandbox({
  sandboxId: "existing-sandbox-id",
});

// ID is exposed for persistence
console.log(sandbox.id); // "sandbox-abc123"
```

**State format**: Just the `sandboxId` string.

### Hybrid (Web App Only)

Location: `apps/web/lib/sandbox/hybrid-sandbox.ts`

**Characteristics**:
- Wraps JustBash, starts Vercel in background
- Tracks write operations for replay during handoff
- Returns errors for commands requiring Vercel (git, npm, etc.)
- Consumer must orchestrate the handoff

**Current API**:
```typescript
// Create
const hybrid = new HybridSandbox({
  justBash: justBashSandbox,
  pendingOperations: [],
});

// Use it (tracks writes internally)
await hybrid.writeFile("/workspace/file.txt", "content", "utf-8");

// Manually trigger handoff when Vercel is ready
await hybrid.performHandoff(vercelSandbox);

// Get pending operations for persistence
const pendingOps = hybrid.pendingOperations;
```

**Problems**:
- Lives in `apps/web`, not `packages/sandbox`
- Consumer has to orchestrate handoff
- Consumer has to track pending operations
- Consumer has to check if Vercel is ready

---

## Current Web App Problems

The web app (`apps/web/app/api/chat/route.ts`) has ~100 lines of sandbox-specific logic:

```typescript
// Mode detection scattered throughout
const isJustBashMode = task.sandboxMode === "justbash" || ...;
const isVercelMode = task.sandboxMode === "vercel" || ...;
const isHybridPlaceholder = sandboxId?.startsWith("justbash-");

// Inline handoff logic
if (isJustBashMode && task.vercelStatus === "ready") {
  // Connect to Vercel
  // Replay pending operations
  // Update task state
}

// Type-specific state persistence
if (hybridSandbox && !handoffPerformed) {
  const justBash = hybridSandbox.getJustBashSandbox();
  const snapshot = justBash.serialize();
  const pendingOps = hybridSandbox.pendingOperations;
  await updateTask(taskId, { justBashSnapshot: snapshot, pendingOperations: pendingOps });
}
```

The database schema has type-specific fields:
```typescript
sandboxMode: text("sandbox_mode", { enum: ["justbash", "vercel"] })
vercelStatus: text("vercel_status", { enum: ["starting", "ready", "failed"] })
justBashSnapshot: jsonb("just_bash_snapshot")
pendingOperations: jsonb("pending_operations")
```

**This is wrong.** The web app shouldn't know about:
- JustBash vs Vercel internals
- Pending operations
- Handoff logic
- Serialization formats

---

## Proposed Unified Interface

### The One Function

```typescript
import { connectSandbox } from "@open-harness/sandbox";

// Create fresh, restore from files, or reconnect to VM - same function
const sandbox = await connectSandbox(state);
```

### SandboxState Type (Flattened Discriminated Union)

```typescript
type SandboxState =
  | ({ type: "just-bash" } & JustBashConfig)
  | ({ type: "vercel" } & VercelConfig)
  | ({ type: "hybrid" } & HybridConfig);
```

### Config Types

Each sandbox type has its own well-defined configuration shape:

```typescript
interface Source {
  repo: string;
  branch?: string;
  token?: string;
}

interface FileEntry {
  type: "file" | "directory" | "symlink";
  content?: string;
  encoding?: "base64";
  mode?: number;
  target?: string; // For symlinks
}

interface PendingOperation =
  | { type: "writeFile"; path: string; content: string }
  | { type: "mkdir"; path: string; recursive: boolean };
```

**JustBashConfig** - Ephemeral in-memory sandbox:
```typescript
interface JustBashConfig {
  // Where to clone from (omit for empty sandbox, omit when restoring)
  source?: Source;
  // For restore (omit for fresh start)
  files?: Record<string, FileEntry>;
  workingDirectory?: string;
  env?: Record<string, string>;
}
```

**VercelConfig** - Persistent cloud VM:
```typescript
interface VercelConfig {
  // Where to clone from (omit for empty sandbox, omit when reconnecting)
  source?: Source;
  // For reconnect to running VM (omit for fresh start)
  sandboxId?: string;
  // For restore from snapshot when VM timed out (sandboxId will be undefined)
  snapshotId?: string;
}
```

**HybridConfig** - Starts ephemeral, transitions to persistent:
```typescript
interface HybridConfig {
  // Where to clone from (needed for fresh start or if Vercel not started yet)
  source?: Source;
  // JustBash component (present when in ephemeral phase)
  files?: Record<string, FileEntry>;
  workingDirectory?: string;
  env?: Record<string, string>;
  // Vercel component (present once Vercel has started)
  sandboxId?: string;
  // For restore from snapshot when VM timed out (sandboxId will be undefined)
  snapshotId?: string;
  // Operations to replay on handoff (present pre-handoff)
  pendingOperations?: PendingOperation[];
}
```

### Source is Orthogonal to Sandbox Type

The `source` field determines WHERE the code comes from, not what kind of sandbox:
- `source` provided → clone repo (works for any sandbox type)
- `source` not provided → empty sandbox OR restore from existing state

### Consumer API

```typescript
import { connectSandbox } from "@open-harness/sandbox";

// Fresh just-bash from repo
const sandbox = await connectSandbox({
  type: "just-bash",
  source: { repo: "https://github.com/owner/repo", branch: "main" },
});

// Fresh vercel from repo
const sandbox = await connectSandbox({
  type: "vercel",
  source: { repo: "https://github.com/owner/repo" },
});

// Fresh hybrid from repo (starts ephemeral, Vercel boots in background)
const sandbox = await connectSandbox({
  type: "hybrid",
  source: { repo: "https://github.com/owner/repo" },
});

// Use it via standard Sandbox interface
await sandbox.exec("ls", sandbox.workingDirectory, 5000);
await sandbox.writeFile("/workspace/file.txt", "content", "utf-8");

// Get state for persistence
const state = sandbox.getState();
await db.save(taskId, { sandboxState: state });

// Later: restore from saved state (same function!)
const savedState = await db.load(taskId);
const sandbox = await connectSandbox(savedState.sandboxState);

// Close when done
await sandbox.stop();
```

### State Round-Trip

The key insight: **what you get from `getState()` is exactly what you pass to `connectSandbox()`**.

**Example: Fresh hybrid → use → save (pre-handoff) → restore → handoff → save (post-handoff)**

```typescript
// 1. Create fresh hybrid
const sandbox = await connectSandbox({
  type: "hybrid",
  source: { repo: "https://github.com/owner/repo" },
});

// 2. Use it (Vercel starting in background)
await sandbox.writeFile("/workspace/file.txt", "content");

// 3. Save state (Vercel not ready yet)
const state = sandbox.getState();
// → {
//     type: "hybrid",
//     files: { "/workspace/file.txt": { type: "file", content: "content" }, ... },
//     workingDirectory: "/workspace",
//     pendingOperations: [{ type: "writeFile", path: "/workspace/file.txt", content: "content" }],
//     source: { repo: "..." },  // Included because Vercel might not have started
//   }

// 4. Later: restore (handoff happens internally when Vercel is ready)
const sandbox = await connectSandbox(state);

// 5. Save state (post-handoff)
const state = sandbox.getState();
// → {
//     type: "hybrid",
//     sandboxId: "sbx-abc123",  // Now just a Vercel reference
//   }
```

**Example: VM timeout recovery with snapshotId**

```typescript
// 1. Sandbox is running on Vercel
const sandbox = await connectSandbox({
  type: "vercel",
  sandboxId: "sbx-abc123",
});

// 2. User is idle, VM is about to timeout
// Before timeout, we snapshot and update state
const snapshotId = await sandbox.createSnapshot();
await db.save(taskId, {
  sandboxState: {
    type: "vercel",
    snapshotId,  // sandboxId is gone - VM timed out
  },
});

// 3. User returns later, we restore from snapshot
const savedState = await db.load(taskId);
// → { type: "vercel", snapshotId: "snap-xyz789" }

const sandbox = await connectSandbox(savedState.sandboxState);
// Internally: spins up new VM, restores from snapshot
// sandbox.id is now "sbx-newid456"

// 4. Save state with new sandboxId
await db.save(taskId, { sandboxState: sandbox.getState() });
// → { type: "vercel", sandboxId: "sbx-newid456" }
```

### Status Type

```typescript
type SandboxStatus =
  | "starting"      // Creating new sandbox
  | "restoring"     // Restoring from saved state (files or snapshot)
  | "reconnecting"  // Reconnecting to existing VM
  | "ready"         // Fully usable
  | "stopping"      // Shutting down
  | "stopped";      // Terminated
```

The status is used directly for UI feedback - users see "Starting sandbox...", "Restoring workspace...", etc.

### Sandbox Interface

```typescript
interface Sandbox {
  // Core operations
  readFile(path: string, encoding: "utf-8"): Promise<string>;
  writeFile(path: string, content: string, encoding: "utf-8"): Promise<void>;
  exec(command: string, cwd: string, timeoutMs: number): Promise<ExecResult>;
  stop(): Promise<void>;
  // ... other existing methods

  // Type identifier
  readonly type: "just-bash" | "vercel" | "hybrid";

  // State for persistence (returns state that can be passed back to connectSandbox)
  getState(): SandboxState;

  // Current status
  readonly status: SandboxStatus;

  // Working directory
  readonly workingDirectory: string;

  // Sandbox ID (only for vercel/hybrid post-handoff)
  readonly id?: string;

  // Pending operations (only for hybrid pre-handoff)
  readonly pendingOperations?: PendingOperation[];
}
```

---

## Implementation Plan

### 1. Define the unified types in packages/sandbox

```typescript
// packages/sandbox/types.ts

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

export interface JustBashConfig {
  source?: Source;
  files?: Record<string, FileEntry>;
  workingDirectory?: string;
  env?: Record<string, string>;
}

export interface VercelConfig {
  source?: Source;
  sandboxId?: string;
  snapshotId?: string;
}

export interface HybridConfig {
  source?: Source;
  files?: Record<string, FileEntry>;
  workingDirectory?: string;
  env?: Record<string, string>;
  sandboxId?: string;
  snapshotId?: string;
  pendingOperations?: PendingOperation[];
}

export type SandboxState =
  | ({ type: "just-bash" } & JustBashConfig)
  | ({ type: "vercel" } & VercelConfig)
  | ({ type: "hybrid" } & HybridConfig);

export type SandboxStatus =
  | "starting"
  | "restoring"
  | "reconnecting"
  | "ready"
  | "stopping"
  | "stopped";
```

### 2. Move HybridSandbox to packages/sandbox

The hybrid sandbox should be a first-class implementation alongside JustBash and Vercel:

```typescript
// packages/sandbox/hybrid.ts
export class HybridSandbox implements Sandbox {
  readonly type = "hybrid" as const;
  private justBash: JustBashSandbox | null;
  private vercel: VercelSandbox | null;
  private _pendingOperations: PendingOperation[];
  private _status: SandboxStatus;
  private source?: Source;

  // Internal: start Vercel in background, handle transition
  // Consumer never sees this complexity
}
```

### 3. Add getState() and status to all implementations

**JustBashSandbox**:
```typescript
readonly type = "just-bash" as const;

getState(): SandboxState {
  return {
    type: "just-bash",
    files: this.serializeFiles(),
    workingDirectory: this.workingDirectory,
    env: this.env,
  };
}

get status(): SandboxStatus {
  return "ready"; // Always ready (in-memory)
}
```

**VercelSandbox**:
```typescript
readonly type = "vercel" as const;

getState(): SandboxState {
  return {
    type: "vercel",
    sandboxId: this.id,
  };
}

get status(): SandboxStatus {
  if (this.isStopped) return "stopped";
  return "ready";
}
```

**HybridSandbox**:
```typescript
readonly type = "hybrid" as const;

getState(): SandboxState {
  // Post-handoff: just return Vercel reference
  if (this.vercel && !this.justBash) {
    return {
      type: "hybrid",
      sandboxId: this.vercel.id,
    };
  }

  // Pre-handoff: return full JustBash state + pending ops
  return {
    type: "hybrid",
    files: this.justBash?.serializeFiles(),
    workingDirectory: this.justBash?.workingDirectory,
    env: this.justBash?.env,
    sandboxId: this.vercel?.id,
    pendingOperations: this._pendingOperations,
    source: this.source, // Needed if Vercel not started yet
  };
}

get status(): SandboxStatus {
  if (this.vercel && !this.justBash) return "ready"; // Post-handoff
  if (this.justBash) return "ready"; // Pre-handoff but usable
  return "initializing";
}
```

### 4. Implement the unified connectSandbox function

```typescript
// packages/sandbox/index.ts

export async function connectSandbox(state: SandboxState): Promise<Sandbox> {
  switch (state.type) {
    case "just-bash":
      return connectJustBash(state);
    case "vercel":
      return connectVercel(state);
    case "hybrid":
      return connectHybrid(state);
  }
}

async function connectJustBash(config: JustBashConfig & { type: "just-bash" }): Promise<JustBashSandbox> {
  // Has files? Restore from them
  if (config.files) {
    return JustBashSandbox.fromFiles(config.files, config.workingDirectory, config.env);
  }
  // Has source? Clone from repo
  if (config.source) {
    return JustBashSandbox.fromSource(config.source);
  }
  // Empty sandbox
  return JustBashSandbox.empty();
}

async function connectVercel(config: VercelConfig & { type: "vercel" }): Promise<VercelSandbox> {
  // Has sandboxId? Reconnect to existing VM
  if (config.sandboxId) {
    return VercelSandbox.reconnect(config.sandboxId);
  }
  // Has snapshotId? VM timed out, restore from snapshot
  if (config.snapshotId) {
    return VercelSandbox.fromSnapshot(config.snapshotId);
  }
  // Has source? Create new VM from repo
  if (config.source) {
    return VercelSandbox.fromSource(config.source);
  }
  // Empty sandbox
  return VercelSandbox.empty();
}

async function connectHybrid(config: HybridConfig & { type: "hybrid" }): Promise<HybridSandbox> {
  // Has sandboxId but no files? Post-handoff, reconnect to Vercel
  if (config.sandboxId && !config.files) {
    return HybridSandbox.reconnect(config.sandboxId);
  }
  // Has snapshotId but no sandboxId? VM timed out, restore from snapshot
  if (config.snapshotId && !config.sandboxId && !config.files) {
    return HybridSandbox.fromSnapshot(config.snapshotId);
  }
  // Has files? Pre-handoff, restore JustBash + maybe connect Vercel
  if (config.files) {
    return HybridSandbox.restore(config);
  }
  // Fresh start from source
  if (config.source) {
    return HybridSandbox.fromSource(config.source);
  }
  // Empty sandbox
  return HybridSandbox.empty();
}
```

### 5. Simplify web app

Database schema becomes:
```typescript
// Just one column for sandbox state
sandboxState: jsonb("sandbox_state"),  // SandboxState
```

Chat route becomes:
```typescript
// Connect (works for fresh, restore, or reconnect)
const sandbox = await connectSandbox(task.sandboxState);

// Use it
const response = await runAgent({ sandbox, messages });

// Persist state
await updateTask(taskId, { sandboxState: sandbox.getState() });
```

No more:
- `isJustBashMode` / `isVercelMode` checks
- `sandboxMode` / `vercelStatus` fields
- `justBashSnapshot` / `pendingOperations` separate fields
- Inline handoff logic
- Type-specific serialization code

### 6. Simplify UI - remove "save sandbox" concept

Users should never be asked "Do you want to save your sandbox?" - state management is automatic and invisible.

**User actions:**
- **Start** - begin working (sandbox is created/restored automatically)
- **Stop** - end session (state is persisted automatically)

**No explicit save/discard.** The system handles persistence on every request boundary.

**Status communicates what's happening:**
```typescript
type SandboxStatus =
  | "starting"      // Creating new sandbox
  | "restoring"     // Restoring from saved state (files or snapshot)
  | "reconnecting"  // Reconnecting to existing VM
  | "ready"         // Fully usable
  | "stopping"      // Shutting down
  | "stopped";      // Terminated
```

The UI shows status like:
- "Starting sandbox..." (fresh)
- "Restoring workspace..." (from files/snapshot)
- "Reconnecting..." (to existing VM)
- "Ready"

Users don't need to know about JustBash vs Vercel vs Hybrid, snapshots, or state serialization. They just see their workspace starting/ready/stopping.

---

## Open Questions

### 1. How does hybrid handle failed Vercel startup?

If Vercel fails to start:
- Stay on JustBash forever? (user has degraded but working experience)
- Retry with backoff?
- Return error status and let consumer decide?
- Include error info in state for debugging?

### 2. Timeout management for Vercel

Current approach: Short timeout (5 min) → actively extend on each interaction.

Alternative: Long timeout (5 hours) → actively close on inactivity.

The alternative might be simpler:
- No need to call `extendTimeout()` constantly
- Track `lastActivityAt`, close if idle for N minutes
- Consumer doesn't need to think about timeout extension

### 3. How to handle sandbox capabilities in UI?

UI needs to know what sandbox can do (git, network, etc.) for:
- Showing available actions
- Displaying limitations

Options:
- `sandbox.capabilities: { git: boolean, network: boolean, ... }`
- `sandbox.environmentDetails` (already exists, but it's a string)
- Derive from `sandbox.type` (just-bash = no git/network, vercel/hybrid = full)

### 4. Snapshot lifecycle for VM timeout recovery

When a Vercel VM times out:
1. Before timeout, create a snapshot and store `snapshotId`
2. Set `sandboxId` to undefined (VM is gone)
3. On next `connectSandbox()`, detect `snapshotId` without `sandboxId`
4. Spin up new VM from snapshot, get new `sandboxId`

Open questions:
- When exactly to create the snapshot? (on every state save? only before timeout?)
- How long do snapshots live? (cost implications)
- Should we proactively snapshot on each `getState()` call for cloud sandboxes?

### 5. Should `getState()` always include source?

Currently source is only included when needed (e.g., hybrid pre-handoff where Vercel might not have started). Should we always include it for recovery scenarios?

---

## Migration Path

1. **Define types** in `packages/sandbox/types.ts`
2. **Add `getState()` and `status`** to existing JustBash and Vercel implementations
3. **Move HybridSandbox** from `apps/web` to `packages/sandbox`
4. **Implement `connectSandbox()`** unified factory function
5. **Update web app** to use new API with single `sandboxState` column
6. **Remove old schema fields** (`sandboxMode`, `vercelStatus`, `justBashSnapshot`, `pendingOperations`)
