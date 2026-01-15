# JustBash Web Integration Experiment

> **WARNING: THIS IS AN EXPERIMENTAL PROOF-OF-CONCEPT**
>
> The changes documented here were made to quickly test whether JustBash could replace Vercel sandbox in the web app. This is NOT the recommended implementation approach. The code bypasses proper architectural patterns and makes assumptions that may not hold in production.
>
> **DO NOT USE THIS AS A GUIDE FOR PRODUCTION IMPLEMENTATION.**

## Purpose

Quick experiment to prove that JustBash can work in the web app, eliminating the ~11 second Vercel sandbox startup time.

## Result

**It works!** Tasks with a `cloneUrl` now use JustBash instead of Vercel, with first response in ~350ms instead of ~11s.

## Changes Made

### 1. Chat Route (`apps/web/app/api/chat/route.ts`)

Added logic to prefer JustBash when task has a `cloneUrl`:

```typescript
// Added imports
import { createJustBashSandbox } from "@open-harness/sandbox";
import { downloadAndExtractTarball } from "@/lib/github/tarball";

// Changed sandbox mode detection
const useJustBash = !!task.justBashSnapshot || !!task.cloneUrl;

// Added tarball download for first request
if (task.justBashSnapshot) {
  // Restore from snapshot (subsequent requests)
  justBashSandbox = await JustBashSandbox.fromSnapshot(snapshot);
} else if (task.cloneUrl) {
  // Download tarball and create JustBash (first request)
  const tarball = await downloadAndExtractTarball(
    task.cloneUrl,
    task.branch ?? "main",
    githubToken ?? undefined,
    WORKING_DIR,
  );
  justBashSandbox = await createJustBashSandbox({
    workingDirectory: WORKING_DIR,
    files: tarball.files,
    mode: "memory",
  });
} else {
  // Fall back to Vercel
  sandbox = await connectVercelSandbox({ ... });
}
```

### 2. Frontend (`apps/web/app/tasks/[id]/task-detail-content.tsx`)

Three changes to bypass Vercel sandbox creation:

#### a) Skip Vercel sandbox creation for tasks with `cloneUrl`

```typescript
const initTask = async () => {
  // If task has cloneUrl, skip Vercel sandbox - JustBash will handle it
  if (task.cloneUrl) {
    sendMessage({ text: task.title });
    return;
  }
  // ... existing Vercel sandbox creation
};
```

#### b) Hide "Create sandbox" overlay for JustBash tasks

```typescript
function SandboxInputOverlay({ useJustBash, ... }) {
  if (useJustBash) {
    return null;
  }
  // ...
}

// Usage:
<SandboxInputOverlay useJustBash={!!task.cloneUrl} ... />
```

#### c) Allow form submission without Vercel sandbox

```typescript
onSubmit={(e) => {
  const canSubmit = !!task.cloneUrl || isSandboxValid(sandboxInfo);
  if (!hasContent || !canSubmit) return;
  // ...
}}
```

## What This Experiment Ignores

1. **Proper state management** - No loading states for JustBash initialization
2. **Error handling** - Tarball download failures not gracefully handled
3. **UI feedback** - No indication to user that JustBash is being used
4. **Sandbox info** - `sandboxInfo` remains null, breaking other UI elements
5. **File browser** - May not work correctly without `sandboxId`
6. **Diff viewer** - May not work correctly without `sandboxId`
7. **Snapshot/restore** - Vercel snapshot UI doesn't apply to JustBash
8. **Timeout handling** - JustBash doesn't timeout like Vercel
9. **Git operations** - JustBash can't run git commands
10. **Package installation** - JustBash can't run npm/pnpm

## Proper Implementation Would Need

1. **New sandbox mode state** - Track whether using JustBash or Vercel
2. **Proper loading states** - Show "Loading repository..." for JustBash init
3. **Unified sandbox interface** - Abstract sandbox operations for both types
4. **File browser support** - Fetch file tree from JustBash snapshot
5. **Diff support** - Compare JustBash state to original tarball
6. **Graceful fallback** - If JustBash fails, fall back to Vercel
7. **Clear UI indication** - Show which sandbox type is active
8. **Hybrid handoff** - Switch to Vercel when git/npm needed (Milestone 3-4)

## Files Changed

- `apps/web/app/api/chat/route.ts` - Sandbox mode selection
- `apps/web/app/tasks/[id]/task-detail-content.tsx` - Frontend bypasses
