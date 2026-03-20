# Sandbox State Persistence via Git Diffs

## Overview

Persist sandbox working state using Git diffs so that when a sandbox times out and a new one is created, the user's work is automatically restored. This creates a seamless experience where users don't notice sandbox recreation.

## Scope

- **Web app only** (not CLI/TUI)
- Capture untracked files with **1MB size limit** per file
- Show **subtle "Restoring workspace..." indicator** during restoration
- Use **`beforeStop` hook** to capture diff (assumes hook fires on timeout)

---

## Implementation Plan

### Phase 1: Database Schema

**File:** `apps/web/lib/db/schema.ts`

Add a new `taskDiffs` table to store captured diffs:

```typescript
export const taskDiffs = pgTable("task_diffs", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  diffContent: text("diff_content").notNull(),        // git diff HEAD output
  untrackedFiles: jsonb("untracked_files"),           // Array<{path, content (base64)}>
  baseCommit: text("base_commit"),                    // SHA for validation
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

**New migration required** after schema update.

---

### Phase 2: Diff Capture Logic

**New file:** `apps/web/lib/sandbox/capture-state.ts`

```typescript
export async function captureSandboxState(sandbox: Sandbox): Promise<{
  diffContent: string;
  untrackedFiles: Array<{ path: string; content: string }>;
  baseCommit: string;
}>
```

**Captures:**
1. `git rev-parse HEAD` - base commit SHA
2. `git diff HEAD` - all tracked file changes (staged + unstaged)
3. `git ls-files --others --exclude-standard` - untracked file paths
4. Read each untracked file (skip if >1MB), base64 encode content

---

### Phase 3: Diff Storage Operations

**New file:** `apps/web/lib/db/task-diffs.ts`

```typescript
// Create new diff, keep only latest 3 per task
export async function createTaskDiff(data: NewTaskDiff): Promise<TaskDiff>

// Get latest diff for restoration
export async function getLatestTaskDiff(taskId: string): Promise<TaskDiff | null>
```

---

### Phase 4: Hook into Sandbox beforeStop

**Modify:** `apps/web/app/api/sandbox/route.ts`

When creating a sandbox, pass a `beforeStop` hook that captures and saves the diff:

```typescript
const sandbox = await connectVercelSandbox({
  timeout: DEFAULT_TIMEOUT,
  source: { ... },
  hooks: {
    beforeStop: async (sandbox) => {
      if (taskId) {
        try {
          const state = await captureSandboxState(sandbox);
          if (state.diffContent || state.untrackedFiles.length > 0) {
            await createTaskDiff({
              id: nanoid(),
              taskId,
              diffContent: state.diffContent,
              untrackedFiles: state.untrackedFiles,
              baseCommit: state.baseCommit,
            });
          }
        } catch (error) {
          console.error("Failed to capture sandbox state in beforeStop:", error);
        }
      }
    },
  },
});
```

**Note:** This requires `taskId` to be available in the hook context. We'll need to capture it in a closure.

---

### Phase 5: Diff Restoration Logic

**New file:** `apps/web/lib/sandbox/restore-state.ts`

```typescript
export async function restoreSandboxState(
  sandbox: Sandbox,
  diff: TaskDiff
): Promise<{ success: boolean; error?: string }>
```

**Steps:**
1. Optionally verify/checkout base commit
2. Write diff to temp file, run `git apply --3way /tmp/restore.patch`
3. Restore untracked files by writing base64-decoded content
4. Clean up temp file
5. Return success/failure status

**Error handling:**
- If `git apply` fails, try `git apply --reject` for partial restoration
- Log failures but don't block sandbox creation
- Skip untracked files that already exist

---

### Phase 6: Integrate Restoration into Sandbox Creation

**Modify:** `apps/web/app/api/sandbox/route.ts`

After creating the sandbox, restore state if a diff exists:

```typescript
const sandbox = await connectVercelSandbox({
  // ... config with beforeStop hook
});

// Restore state if this task has a stored diff
let stateRestored = false;
if (taskId) {
  const latestDiff = await getLatestTaskDiff(taskId);
  if (latestDiff) {
    const result = await restoreSandboxState(sandbox, latestDiff);
    stateRestored = result.success;
    if (!result.success) {
      console.warn("Partial state restoration:", result.error);
    }
  }
}

return Response.json({
  sandboxId: sandbox.id,
  createdAt: Date.now(),
  timeout: DEFAULT_TIMEOUT,
  currentBranch: sandbox.currentBranch,
  stateRestored,  // inform client
});
```

---

### Phase 7: Client-Side UI Feedback

**Modify:** `apps/web/app/tasks/[id]/task-detail-content.tsx`

When `createSandbox` is called:
1. Show "Restoring workspace..." text during sandbox creation (if task has messages)
2. If `stateRestored: true` in response, continue normally
3. If restoration failed, show subtle warning but continue

---

## File Changes Summary

| File | Action |
|------|--------|
| `apps/web/lib/db/schema.ts` | Add `taskDiffs` table |
| `apps/web/lib/db/task-diffs.ts` | **New** - CRUD operations |
| `apps/web/lib/sandbox/capture-state.ts` | **New** - diff capture logic |
| `apps/web/lib/sandbox/restore-state.ts` | **New** - diff restoration logic |
| `apps/web/app/api/sandbox/route.ts` | Add `beforeStop` hook + restoration after creation |
| `apps/web/app/tasks/[id]/task-detail-content.tsx` | Add "Restoring workspace..." UI |

---

## Key Design Points

### Why beforeStop Hook

Using `beforeStop` is more efficient than capturing after every message:
- Only runs once when sandbox is stopping
- No per-message overhead
- Git diff operation is slightly slow (~100-500ms), so doing it once is better

**Assumption:** The `beforeStop` hook will be called even when the sandbox times out (not just on explicit `stop()` calls). If this isn't the case, we may need to add periodic capture as a fallback.

### Diff Retention

Keep only the latest 3 diffs per task to prevent unbounded storage growth. Older diffs are automatically deleted when a new one is created.

### Untracked File Handling

- Files >1MB are skipped (likely generated files)
- Binary files are base64 encoded (safe for any content)
- Existing files are not overwritten during restoration

---

## Verification Plan

1. **Manual testing:**
   - Create a task, make file changes via the agent
   - Wait for sandbox to expire (or manually trigger `stop()`)
   - Create a new sandbox for the same task
   - Verify files are restored correctly

2. **Edge cases to test:**
   - Large untracked file (>1MB) - should be skipped
   - Binary files - should be handled gracefully
   - Conflicting changes (rare) - should partially restore with warnings
   - Empty diff (no changes) - should not create a diff record

3. **Database verification:**
   - Check `task_diffs` table is populated after sandbox stop
   - Verify old diffs are cleaned up (only latest 3 kept)
