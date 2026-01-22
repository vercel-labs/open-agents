# Sandbox Type Preservation on Restore

## Problem Statement

When a user creates a Vercel sandbox, saves a snapshot, and later tries to restore it, the sandbox incorrectly starts as a Hybrid sandbox instead of Vercel.

### Root Cause

The `sandboxState` field serves two conflicting purposes:

1. **Runtime state** - Is a sandbox currently running? (checked via `!task.sandboxState`)
2. **Configuration** - What type of sandbox should this task use? (`sandboxState.type`)

When a sandbox is stopped (via DELETE `/api/sandbox`), we set `sandboxState: null` to signal "no active sandbox". This wipes out the `type` information needed for restoration.

### Current Flow (Broken)

1. User creates Vercel sandbox → `sandboxState = { type: "vercel", sandboxId: "abc" }`
2. User saves snapshot → `snapshotUrl` saved, `sandboxState` unchanged
3. User stops sandbox → DELETE called → `sandboxState = null` (type lost!)
4. User restores → `task.sandboxState?.type` is undefined → falls back to `"hybrid"`

### Affected Code

- `apps/web/app/api/sandbox/route.ts:259` - DELETE sets `sandboxState: null`
- `apps/web/app/api/sandbox/reconnect/route.ts:64` - Reconnect failure sets `sandboxState: null`
- `apps/web/app/tasks/[id]/task-context.tsx:121,148,151` - Frontend clears state

Many places check `!task.sandboxState` to determine if a sandbox is active:
- `apps/web/app/api/chat/route.ts:55`
- `apps/web/app/api/sandbox/route.ts:251`
- `apps/web/app/api/sandbox/extend/route.ts:38`
- `apps/web/app/api/sandbox/reconnect/route.ts:38`
- `apps/web/app/api/sandbox/snapshot/route.ts:44,116`
- `apps/web/app/api/tasks/[id]/diff/route.ts:173`
- `apps/web/app/api/tasks/[id]/files/route.ts:80`
- `apps/web/app/api/git-status/route.ts:36`
- `apps/web/app/api/github/create-repo/route.ts:66`
- `apps/web/app/api/generate-pr/route.ts:88`

## Suggested Solution

### Key Insight

The `SandboxState` types already support having just the type without runtime fields:

```typescript
// VercelState - all fields optional
export interface VercelState {
  source?: Source;
  sandboxId?: string;   // optional
  snapshotId?: string;  // optional
}

// This is already valid:
const state: SandboxState = { type: "vercel" };
```

### Approach

Instead of setting `sandboxState: null`, preserve the type:

```typescript
// Before (loses type)
await updateTask(taskId, { sandboxState: null });

// After (preserves type)
await updateTask(taskId, {
  sandboxState: { type: task.sandboxState.type }
});
```

Change "is sandbox active" checks from `!task.sandboxState` to checking for active state:

```typescript
// Before
if (!task.sandboxState) {
  return Response.json({ error: "No sandbox" }, { status: 400 });
}

// After
if (!isSandboxActive(task.sandboxState)) {
  return Response.json({ error: "No sandbox" }, { status: 400 });
}
```

### Implementation

#### 1. Add helper function

Create a helper in `apps/web/lib/sandbox/utils.ts`:

```typescript
import type { SandboxState } from "@open-harness/sandbox";

/**
 * Check if a sandbox state represents an active/running sandbox.
 * A sandbox is active if it has runtime state (sandboxId for cloud types,
 * or files for just-bash/pre-handoff hybrid).
 */
export function isSandboxActive(state: SandboxState | null | undefined): boolean {
  if (!state) return false;

  switch (state.type) {
    case "vercel":
      return !!state.sandboxId;
    case "hybrid":
      return !!state.sandboxId || !!state.files;
    case "just-bash":
      return !!state.files;
    default:
      return false;
  }
}
```

#### 2. Update DELETE endpoint

`apps/web/app/api/sandbox/route.ts`:

```typescript
// Instead of:
await updateTask(taskId, { sandboxState: null });

// Do:
await updateTask(taskId, {
  sandboxState: task.sandboxState
    ? { type: task.sandboxState.type }
    : null
});
```

#### 3. Update reconnect failure

`apps/web/app/api/sandbox/reconnect/route.ts`:

```typescript
// Instead of:
await updateTask(taskId, { sandboxState: null });

// Do:
await updateTask(taskId, {
  sandboxState: task.sandboxState
    ? { type: task.sandboxState.type }
    : null
});
```

#### 4. Update all `!task.sandboxState` checks

Replace with `!isSandboxActive(task.sandboxState)` in:
- `apps/web/app/api/chat/route.ts`
- `apps/web/app/api/sandbox/route.ts`
- `apps/web/app/api/sandbox/extend/route.ts`
- `apps/web/app/api/sandbox/reconnect/route.ts`
- `apps/web/app/api/sandbox/snapshot/route.ts`
- `apps/web/app/api/tasks/[id]/diff/route.ts`
- `apps/web/app/api/tasks/[id]/files/route.ts`
- `apps/web/app/api/git-status/route.ts`
- `apps/web/app/api/github/create-repo/route.ts`
- `apps/web/app/api/generate-pr/route.ts`

#### 5. Update frontend context

`apps/web/app/tasks/[id]/task-context.tsx`:

```typescript
// Instead of:
setTask((prev) => ({ ...prev, sandboxState: null }));

// Do:
setTask((prev) => ({
  ...prev,
  sandboxState: prev.sandboxState
    ? { type: prev.sandboxState.type }
    : null
}));
```

#### 6. Update restore logic

`apps/web/app/tasks/[id]/task-detail-content.tsx` and `apps/web/app/api/sandbox/snapshot/route.ts`:

Now `task.sandboxState?.type` will have the correct value, so the existing code works:

```typescript
// This now works correctly
task.sandboxState?.type ?? "hybrid"
```

### Testing

1. Create a Vercel sandbox for a task
2. Save snapshot and stop sandbox
3. Verify `task.sandboxState` is `{ type: "vercel" }` (not null)
4. Restore from snapshot
5. Verify sandbox is Vercel type (not hybrid)

Repeat for hybrid sandbox to ensure that also preserves correctly.

### Migration

No database migration needed - the types already support this. Existing tasks with `sandboxState: null` will continue to work (fall back to hybrid as before).
