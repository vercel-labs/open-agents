# Hybrid Sandbox Completion Plan

This document outlines the implementation plan to complete the hybrid sandbox abstraction, making it fully functional without requiring consumer orchestration.

## Problem Statement

The current hybrid sandbox abstraction is incomplete. The web app (`apps/web/app/api/sandbox/route.ts`) contains provider-specific logic that should be encapsulated within the sandbox abstraction:

1. Direct imports of `connectVercelSandbox` and `createJustBashSandbox`
2. Manual orchestration of background Vercel startup
3. Direct database updates when Vercel becomes ready
4. Provider-specific configuration building

A proper abstraction should allow the consumer to simply call `connectSandbox()` with state and options, and have all orchestration handled internally.

## Design Decisions

### 1. No provider names in the abstraction

- Use `onCloudSandboxReady` instead of `onVercelReady`
- Allows swapping cloud providers without interface changes

### 2. Hybrid-specific hooks are scoped to hybrid

- Base `SandboxHooks` interface remains unchanged
- New `HybridHooks` interface extends `SandboxHooks` with hybrid-specific hooks
- Lives in `packages/sandbox/hybrid/` folder

### 3. Discriminated union for type-safe config

- Single `connectSandbox(config)` function with discriminated union
- TypeScript narrows options type based on state type
- No internal casting required

### 4. Client handles tarball download

- Sandbox receives `files`, not source URLs for download
- Client (web app) downloads tarball and extracts files
- `source` field is only used for cloud sandbox cloning (not tarball download)

### 5. Clear separation of state vs options

- `state`: Persisted to database (type, files, sandboxId, etc.)
- `options`: Runtime only (env, gitUser, hooks, registerBackgroundTask)

### 6. Background task registration for serverless

- `registerBackgroundTask` option allows consumer to register promises that should outlive the request
- Consumer wires this to their runtime's `waitUntil` (Next.js, Cloudflare, etc.)
- Keeps abstraction framework-agnostic

---

## Type Definitions

### Base Hooks (unchanged)

```typescript
// packages/sandbox/interface.ts - NO CHANGES
export interface SandboxHooks {
  afterStart?: SandboxHook;
  beforeStop?: SandboxHook;
  onTimeout?: SandboxHook;
  onTimeoutExtended?: (sandbox: Sandbox, additionalMs: number) => Promise<void>;
}
```

### Hybrid-Specific Hooks (new file)

```typescript
// packages/sandbox/hybrid/hooks.ts
import type { Sandbox, SandboxHooks } from "../interface";

/**
 * Hooks specific to hybrid sandbox lifecycle.
 * Extends base SandboxHooks with hybrid-specific events.
 */
export interface HybridHooks extends SandboxHooks {
  /**
   * Called when the cloud sandbox becomes ready during hybrid mode.
   * Use this to persist the sandboxId for future reconnection.
   *
   * @param sandboxId - The ID of the ready cloud sandbox
   * @param sandbox - The cloud sandbox instance
   */
  onCloudSandboxReady?: (sandboxId: string, sandbox: Sandbox) => Promise<void>;

  /**
   * Called if cloud sandbox background startup fails.
   * The hybrid sandbox continues working with the ephemeral sandbox.
   *
   * @param error - The error that occurred
   */
  onCloudSandboxFailed?: (error: Error) => Promise<void>;
}
```

### Connect Options

```typescript
// packages/sandbox/factory.ts

/**
 * Base connect options for all sandbox types.
 */
export interface ConnectOptions {
  env?: Record<string, string>;
  gitUser?: { name: string; email: string };
  hooks?: SandboxHooks;
}

/**
 * Connect options with hybrid-specific hooks and background task support.
 */
export interface HybridConnectOptions extends Omit<ConnectOptions, "hooks"> {
  env?: Record<string, string>;
  gitUser?: { name: string; email: string };
  hooks?: HybridHooks;
  /**
   * Register a background task that should complete even after the response is sent.
   * In serverless environments, wire this to your runtime's `waitUntil`:
   *
   * @example
   * import { waitUntil } from 'next/server';
   *
   * registerBackgroundTask: (promise) => waitUntil(promise),
   */
  registerBackgroundTask?: (promise: Promise<unknown>) => void;
}
```

### Discriminated Union Config

```typescript
// packages/sandbox/factory.ts

/**
 * Configuration for connecting to a sandbox.
 * Discriminated union ensures type-safe options for each sandbox type.
 */
export type SandboxConnectConfig =
  | { state: { type: "just-bash" } & JustBashState; options?: ConnectOptions }
  | { state: { type: "vercel" } & VercelState; options?: ConnectOptions }
  | { state: { type: "hybrid" } & HybridState; options?: HybridConnectOptions };
```

### Hybrid State (updated)

```typescript
// packages/sandbox/hybrid/state.ts
import type { Source, FileEntry, PendingOperation } from "../types";

/**
 * State configuration for hybrid sandbox.
 *
 * The hybrid sandbox starts with an ephemeral component (JustBash) and
 * transitions to a persistent cloud component when ready.
 */
export interface HybridState {
  // === Ephemeral component (JustBash) ===

  /** File state for JustBash (client provides, extracted from tarball) */
  files?: Record<string, FileEntry>;
  /** Working directory path */
  workingDirectory?: string;
  /** Environment variables */
  env?: Record<string, string>;

  // === Cloud component ===

  /** Source for cloud sandbox cloning (NOT for tarball download) */
  source?: Source;
  /** Cloud sandbox ID (present once cloud sandbox is running) */
  sandboxId?: string;
  /** Snapshot ID for restoring when cloud sandbox timed out */
  snapshotId?: string;

  // === Handoff ===

  /** Operations to replay on handoff (present pre-handoff) */
  pendingOperations?: PendingOperation[];
}
```

---

## Implementation Steps

### Step 1: Create hybrid hooks file

Create `packages/sandbox/hybrid/hooks.ts` with `HybridHooks` interface.

**Files to create:**
- `packages/sandbox/hybrid/hooks.ts`

**Files to update:**
- `packages/sandbox/hybrid/index.ts` (export new types)

### Step 2: Update factory with discriminated union

Refactor `connectSandbox` to use discriminated union config.

**Files to update:**
- `packages/sandbox/factory.ts`
  - Add `SandboxConnectConfig` type
  - Add `HybridConnectOptions` type
  - Change `connectSandbox(state, options)` to `connectSandbox(config)`
  - Remove internal casting

### Step 3: Update hybrid connect to start cloud sandbox in background

Enhance `connectHybrid` to automatically start cloud sandbox when `source` is provided.

**Files to update:**
- `packages/sandbox/hybrid/connect.ts`
  - Accept `HybridConnectOptions`
  - Add `startCloudSandboxInBackground` function
  - Wire up `onCloudSandboxReady` and `onCloudSandboxFailed` hooks
  - Use `registerBackgroundTask` for the cloud startup promise

### Step 4: Update hybrid state type

Ensure `HybridState` properly documents the separation of concerns.

**Files to update:**
- `packages/sandbox/hybrid/state.ts`
  - Add documentation clarifying files vs source usage

### Step 5: Update package exports

Ensure all new types are properly exported.

**Files to update:**
- `packages/sandbox/index.ts`
- `packages/sandbox/hybrid/index.ts`

### Step 6: Migrate web app sandbox route

Refactor to use the new unified API.

**Files to update:**
- `apps/web/app/api/sandbox/route.ts`
  - Remove direct imports of `connectVercelSandbox`, `createJustBashSandbox`
  - Use `connectSandbox({ state, options })` pattern
  - Move tarball download to be explicit client responsibility
  - Use `onCloudSandboxReady` hook for state persistence
  - Wire `registerBackgroundTask` to Next.js `waitUntil`

### Step 7: Update any other consumers

Search for other usages of the old API and update them.

**Files to check:**
- `apps/web/app/api/chat/route.ts`
- Any other files importing from `@open-harness/sandbox`

### Step 8: Update tests

Update or add tests for the new API.

**Files to update/create:**
- `packages/sandbox/hybrid/connect.test.ts`
- `packages/sandbox/factory.test.ts`

---

## Detailed Implementation

### packages/sandbox/hybrid/hooks.ts (new file)

```typescript
import type { Sandbox, SandboxHooks } from "../interface";

/**
 * Hooks specific to hybrid sandbox lifecycle.
 * Extends base SandboxHooks with hybrid-specific events.
 */
export interface HybridHooks extends SandboxHooks {
  /**
   * Called when the cloud sandbox becomes ready during hybrid mode.
   * Use this to persist the sandboxId for future reconnection.
   *
   * This hook is called asynchronously after connectSandbox returns.
   * The hybrid sandbox is usable immediately; this hook fires when
   * the background cloud sandbox startup completes.
   *
   * @param sandboxId - The ID of the ready cloud sandbox
   * @param sandbox - The cloud sandbox instance
   *
   * @example
   * onCloudSandboxReady: async (sandboxId) => {
   *   await updateTask(taskId, {
   *     sandboxState: { type: "hybrid", sandboxId },
   *   });
   * }
   */
  onCloudSandboxReady?: (sandboxId: string, sandbox: Sandbox) => Promise<void>;

  /**
   * Called if cloud sandbox background startup fails.
   * The hybrid sandbox continues working with the ephemeral sandbox.
   *
   * @param error - The error that occurred during cloud sandbox startup
   *
   * @example
   * onCloudSandboxFailed: async (error) => {
   *   console.error("Cloud sandbox failed:", error);
   *   // Optionally notify user or retry
   * }
   */
  onCloudSandboxFailed?: (error: Error) => Promise<void>;
}
```

### packages/sandbox/factory.ts (updated)

```typescript
import type { Sandbox, SandboxHooks } from "./interface";
import type { JustBashState } from "./just-bash/state";
import type { VercelState } from "./vercel/state";
import type { HybridState } from "./hybrid/state";
import type { HybridHooks } from "./hybrid/hooks";
import { connectJustBash } from "./just-bash/connect";
import { connectVercel } from "./vercel/connect";
import { connectHybrid } from "./hybrid/connect";

export type { SandboxStatus } from "./types";

/**
 * Unified sandbox state type.
 * Use `type` discriminator to determine which sandbox implementation to use.
 */
export type SandboxState =
  | ({ type: "just-bash" } & JustBashState)
  | ({ type: "vercel" } & VercelState)
  | ({ type: "hybrid" } & HybridState);

/**
 * Base connect options for all sandbox types.
 */
export interface ConnectOptions {
  /** Environment variables (e.g., GITHUB_TOKEN) */
  env?: Record<string, string>;
  /** Git user for commits (cloud sandboxes only) */
  gitUser?: { name: string; email: string };
  /** Lifecycle hooks */
  hooks?: SandboxHooks;
}

/**
 * Connect options with hybrid-specific hooks and background task support.
 */
export interface HybridConnectOptions extends Omit<ConnectOptions, "hooks"> {
  /** Environment variables (e.g., GITHUB_TOKEN) */
  env?: Record<string, string>;
  /** Git user for commits */
  gitUser?: { name: string; email: string };
  /** Lifecycle hooks including hybrid-specific hooks */
  hooks?: HybridHooks;
  /**
   * Register a background task that should complete even after the response is sent.
   * In serverless environments, wire this to your runtime's `waitUntil`:
   *
   * @example
   * import { waitUntil } from 'next/server';
   *
   * registerBackgroundTask: (promise) => waitUntil(promise),
   */
  registerBackgroundTask?: (promise: Promise<unknown>) => void;
}

/**
 * Configuration for connecting to a sandbox.
 * Discriminated union ensures type-safe options for each sandbox type.
 */
export type SandboxConnectConfig =
  | { state: { type: "just-bash" } & JustBashState; options?: ConnectOptions }
  | { state: { type: "vercel" } & VercelState; options?: ConnectOptions }
  | { state: { type: "hybrid" } & HybridState; options?: HybridConnectOptions };

/**
 * Connect to a sandbox based on the provided configuration.
 *
 * This is the unified entry point for creating, restoring, or reconnecting
 * to any sandbox type. The `type` field in state determines which implementation
 * is used, and the options are type-checked accordingly.
 *
 * @param config - State and options for the sandbox
 * @returns A connected sandbox instance
 *
 * @example
 * // Fresh hybrid with files (client downloaded tarball)
 * const sandbox = await connectSandbox({
 *   state: {
 *     type: "hybrid",
 *     files: extractedFiles,
 *     workingDirectory: "/workspace",
 *     source: { repo: "https://github.com/owner/repo", branch: "main" },
 *   },
 *   options: {
 *     env: { GITHUB_TOKEN: token },
 *     registerBackgroundTask: (p) => waitUntil(p),
 *     hooks: {
 *       onCloudSandboxReady: async (sandboxId) => {
 *         await persistState({ type: "hybrid", sandboxId });
 *       },
 *     },
 *   },
 * });
 *
 * @example
 * // Reconnect to existing cloud sandbox
 * const sandbox = await connectSandbox({
 *   state: { type: "hybrid", sandboxId: "sbx-abc123" },
 *   options: { env: { GITHUB_TOKEN: token } },
 * });
 */
export async function connectSandbox(
  config: SandboxConnectConfig
): Promise<Sandbox> {
  switch (config.state.type) {
    case "just-bash":
      return connectJustBash(config.state, config.options);
    case "vercel":
      return connectVercel(config.state, config.options);
    case "hybrid":
      return connectHybrid(config.state, config.options);
  }
}
```

### packages/sandbox/hybrid/connect.ts (updated)

```typescript
import type { Sandbox } from "../interface";
import type { HybridState } from "./state";
import type { HybridHooks } from "./hooks";
import { HybridSandbox } from "./sandbox";
import { connectJustBash } from "../just-bash/connect";
import { connectVercel } from "../vercel/connect";

export interface HybridConnectOptions {
  env?: Record<string, string>;
  gitUser?: { name: string; email: string };
  hooks?: HybridHooks;
  /**
   * Register a background task that should complete even after the response is sent.
   * In serverless environments, wire this to your runtime's `waitUntil`.
   */
  registerBackgroundTask?: (promise: Promise<unknown>) => void;
}

/**
 * Start cloud sandbox in background and wire up hooks.
 * Returns the promise so it can be registered with waitUntil.
 */
function startCloudSandboxInBackground(
  source: NonNullable<HybridState["source"]>,
  options: HybridConnectOptions | undefined,
  hybrid: HybridSandbox
): Promise<void> {
  const cloudStartupPromise = (async () => {
    try {
      const cloudSandbox = await connectVercel(
        { source },
        {
          env: options?.env,
          gitUser: options?.gitUser,
          hooks: options?.hooks,
        }
      );

      // Perform handoff
      await hybrid.performHandoff(cloudSandbox);

      // Notify consumer via hook
      const sandboxId = cloudSandbox.id;
      if (sandboxId && options?.hooks?.onCloudSandboxReady) {
        await options.hooks.onCloudSandboxReady(sandboxId, cloudSandbox);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("[HybridSandbox] Cloud sandbox startup failed:", err);

      if (options?.hooks?.onCloudSandboxFailed) {
        await options.hooks.onCloudSandboxFailed(err);
      }
    }
  })();

  // Register with waitUntil if provided
  if (options?.registerBackgroundTask) {
    options.registerBackgroundTask(cloudStartupPromise);
  }

  return cloudStartupPromise;
}

/**
 * Connect to a Hybrid sandbox based on the provided state.
 *
 * Hybrid sandboxes start with JustBash (ephemeral) and can transition to
 * a cloud sandbox (persistent) via handoff. The state determines which phase:
 *
 * - Post-handoff (sandboxId present, no files): Reconnect directly to cloud
 * - Post-handoff recovery (snapshotId present, no sandboxId, no files): Restore from snapshot
 * - Inline handoff (sandboxId + files): Cloud ready, perform handoff now
 * - Pre-handoff (files present, no sandboxId): Restore JustBash, optionally start cloud
 * - Error (no files, no sandboxId): Invalid state
 */
export async function connectHybrid(
  state: HybridState,
  options?: HybridConnectOptions
): Promise<HybridSandbox> {
  // Post-handoff: Just reconnect to cloud sandbox
  // (sandboxId present, no files means we've already transitioned)
  if (state.sandboxId && !state.files) {
    const cloudSandbox = await connectVercel(
      { sandboxId: state.sandboxId },
      {
        env: options?.env,
        hooks: options?.hooks,
      }
    );

    // Create hybrid wrapper that's already in "cloud" state
    const hybrid = new HybridSandbox({
      justBash: await connectJustBash({
        workingDirectory: cloudSandbox.workingDirectory,
      }),
    });

    await hybrid.performHandoff(cloudSandbox);
    return hybrid;
  }

  // Post-handoff recovery: Cloud sandbox timed out, restore from snapshot
  if (state.snapshotId && !state.sandboxId && !state.files) {
    const cloudSandbox = await connectVercel(
      { snapshotId: state.snapshotId },
      {
        env: options?.env,
        gitUser: options?.gitUser,
        hooks: options?.hooks,
      }
    );

    const hybrid = new HybridSandbox({
      justBash: await connectJustBash({
        workingDirectory: cloudSandbox.workingDirectory,
      }),
    });

    await hybrid.performHandoff(cloudSandbox);
    return hybrid;
  }

  // Pre-handoff but cloud ready: Perform inline handoff
  // (sandboxId + files means cloud is ready but we haven't switched yet)
  if (state.sandboxId && state.files) {
    const cloudSandbox = await connectVercel(
      { sandboxId: state.sandboxId },
      {
        env: options?.env,
        hooks: options?.hooks,
      }
    );

    // Replay pending operations
    const pendingOps = state.pendingOperations ?? [];
    const errors: string[] = [];

    for (const op of pendingOps) {
      try {
        if (op.type === "mkdir") {
          await cloudSandbox.mkdir(op.path, { recursive: op.recursive });
        } else if (op.type === "writeFile") {
          await cloudSandbox.writeFile(op.path, op.content, "utf-8");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to replay ${op.type} for ${op.path}: ${message}`);
      }
    }

    if (errors.length > 0) {
      console.warn(
        `[HybridSandbox] Inline handoff replay errors (${errors.length}/${pendingOps.length}):`,
        errors
      );
    }

    // Create hybrid in post-handoff state
    const hybrid = new HybridSandbox({
      justBash: await connectJustBash({
        workingDirectory: cloudSandbox.workingDirectory,
      }),
    });

    await hybrid.performHandoff(cloudSandbox);
    return hybrid;
  }

  // Pre-handoff: Create/restore JustBash from files
  if (state.files) {
    const justBash = await connectJustBash(
      {
        files: state.files,
        workingDirectory: state.workingDirectory,
        env: state.env,
      },
      {
        env: options?.env,
        hooks: options?.hooks,
      }
    );

    const hybrid = new HybridSandbox({
      justBash,
      pendingOperations: state.pendingOperations,
    });

    // If source provided and no sandboxId yet, start cloud in background
    if (state.source && !state.sandboxId) {
      startCloudSandboxInBackground(state.source, options, hybrid);
    }

    return hybrid;
  }

  // Invalid state: no files and no sandboxId
  throw new Error(
    "Invalid HybridState: requires either 'files' for ephemeral mode or 'sandboxId' for cloud mode"
  );
}
```

### apps/web/app/api/sandbox/route.ts (updated)

```typescript
import { connectSandbox } from "@open-harness/sandbox";
import { waitUntil } from "next/server";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { getServerSession } from "@/lib/session/get-server-session";
import { getTaskById, updateTask } from "@/lib/db/tasks";
import { downloadAndExtractTarball } from "@/lib/github/tarball";

const DEFAULT_TIMEOUT = 300_000; // 5 minutes
const WORKING_DIR = "/vercel/sandbox";

interface CreateSandboxRequest {
  repoUrl?: string;
  branch?: string;
  isNewBranch?: boolean;
  taskId?: string;
  sandboxId?: string;
}

export async function POST(req: Request) {
  let body: CreateSandboxRequest;
  try {
    body = (await req.json()) as CreateSandboxRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    repoUrl,
    branch = "main",
    isNewBranch = false,
    taskId,
    sandboxId: providedSandboxId,
  } = body;

  // Get user's GitHub token
  const githubToken = await getUserGitHubToken();
  if (!githubToken) {
    return Response.json({ error: "GitHub not connected" }, { status: 401 });
  }

  // Get session for git user info
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Validate task ownership
  let task;
  if (taskId) {
    task = await getTaskById(taskId);
    if (!task) {
      return Response.json({ error: "Task not found" }, { status: 404 });
    }
    if (task.userId !== session.user.id) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const gitUser = {
    name: session.user.name ?? session.user.username,
    email:
      session.user.email ??
      `${session.user.username}@users.noreply.github.com`,
  };

  // ============================================
  // RECONNECT: Existing sandbox
  // ============================================
  if (providedSandboxId) {
    const sandbox = await connectSandbox({
      state: { type: "hybrid", sandboxId: providedSandboxId },
      options: { env: { GITHUB_TOKEN: githubToken } },
    });

    return Response.json({
      sandboxId: providedSandboxId,
      createdAt: Date.now(),
      timeout: DEFAULT_TIMEOUT,
      currentBranch: sandbox.currentBranch,
      mode: "hybrid",
    });
  }

  // ============================================
  // NEW SANDBOX: Hybrid approach
  // ============================================
  if (repoUrl && taskId) {
    const startTime = Date.now();

    // Client responsibility: Download and extract tarball
    let tarballResult;
    try {
      tarballResult = await downloadAndExtractTarball(
        repoUrl,
        branch,
        githubToken,
        WORKING_DIR,
      );
    } catch {
      // Retry without token for public repos
      tarballResult = await downloadAndExtractTarball(
        repoUrl,
        branch,
        undefined,
        WORKING_DIR,
      );
    }

    // Connect to hybrid sandbox with files
    const sandbox = await connectSandbox({
      state: {
        type: "hybrid",
        files: tarballResult.files,
        workingDirectory: WORKING_DIR,
        source: {
          repo: repoUrl,
          branch: isNewBranch ? undefined : branch,
          token: githubToken,
        },
      },
      options: {
        env: { GITHUB_TOKEN: githubToken },
        gitUser,
        // Register background task with Next.js waitUntil
        registerBackgroundTask: (promise) => waitUntil(promise),
        hooks: {
          onCloudSandboxReady: async (sandboxId) => {
            // Update task state when cloud sandbox is ready
            const currentTask = await getTaskById(taskId);
            if (currentTask?.sandboxState?.type === "hybrid") {
              await updateTask(taskId, {
                sandboxState: { type: "hybrid", sandboxId },
              });
              console.log(
                `[Sandbox] Cloud sandbox ready for task ${taskId}: ${sandboxId}`
              );
            }
          },
          onCloudSandboxFailed: async (error) => {
            console.error(
              `[Sandbox] Cloud sandbox failed for task ${taskId}:`,
              error.message
            );
          },
        },
      },
    });

    // Persist initial state (JustBash files + pending ops)
    await updateTask(taskId, { sandboxState: sandbox.getState() });

    const readyMs = Date.now() - startTime;

    return Response.json({
      createdAt: Date.now(),
      timeout: DEFAULT_TIMEOUT,
      currentBranch: branch,
      mode: "hybrid",
      timing: { readyMs },
    });
  }

  // ============================================
  // FALLBACK: Direct cloud sandbox (no repo)
  // ============================================
  const sandbox = await connectSandbox({
    state: { type: "vercel", source: undefined },
    options: {
      env: { GITHUB_TOKEN: githubToken },
      gitUser,
    },
  });

  if (taskId) {
    await updateTask(taskId, { sandboxState: sandbox.getState() });
  }

  return Response.json({
    sandboxId: sandbox.id,
    createdAt: Date.now(),
    timeout: DEFAULT_TIMEOUT,
    mode: "vercel",
  });
}

export async function DELETE(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("taskId" in body) ||
    typeof (body as Record<string, unknown>).taskId !== "string"
  ) {
    return Response.json({ error: "Missing taskId" }, { status: 400 });
  }

  const { taskId } = body as { taskId: string };

  const task = await getTaskById(taskId);
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }
  if (task.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!task.sandboxState) {
    return Response.json({ error: "No sandbox to stop" }, { status: 400 });
  }

  // Connect and stop using unified API
  const sandbox = await connectSandbox({
    state: task.sandboxState,
    options: undefined,
  });
  await sandbox.stop();

  await updateTask(taskId, { sandboxState: null });

  return Response.json({ success: true });
}
```

---

## Migration Checklist

- [x] **Step 1**: Create `packages/sandbox/hybrid/hooks.ts`
- [x] **Step 2**: Update `packages/sandbox/factory.ts` with discriminated union
- [x] **Step 3**: Update `packages/sandbox/hybrid/connect.ts` with background cloud startup
- [x] **Step 4**: Update `packages/sandbox/hybrid/state.ts` documentation
- [x] **Step 5**: Update package exports (`index.ts` files)
- [x] **Step 6**: Migrate `apps/web/app/api/sandbox/route.ts`
- [x] **Step 7**: Check and update other consumers
- [ ] **Step 8**: Add/update tests
- [x] **Step 9**: Run typecheck: `turbo typecheck`
- [x] **Step 10**: Run linter: `turbo lint`
- [ ] **Step 11**: Manual testing of hybrid sandbox flow

---

## Verification

After implementation, verify:

1. **Type safety**: No TypeScript errors, no internal casts
2. **Web app only imports `connectSandbox`**: No direct provider imports
3. **Hooks fire correctly**: `onCloudSandboxReady` called when cloud is ready
4. **Background task completes**: `waitUntil` ensures cloud startup finishes
5. **State persistence works**: `getState()` returns correct state at each phase
6. **Reconnect works**: Can restore from persisted state
7. **Handoff works**: Pending operations replayed correctly

---

## Future Considerations

1. **Additional cloud providers**: The abstraction supports swapping Vercel for another provider
2. **Retry logic**: Could add retry with backoff for cloud sandbox failures
3. **Progress callbacks**: Could add `onCloudSandboxProgress` for startup progress
4. **Timeout configuration**: Cloud sandbox timeout could be configurable via options
