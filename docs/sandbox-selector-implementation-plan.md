# Plan: Add Sandbox Type Selector to Task Input

## Summary

Add a sandbox type selector to the task input UI, allowing users to choose between `hybrid`, `vercel`, or `just-bash` sandbox types when creating a task. Follows the existing `ModelSelectorCompact` pattern.

## Design Decisions

1. **Selection timing**: Only at task creation (not changeable mid-task)
2. **Default behavior**:
   - With repo: Default to `hybrid` (recommended)
   - Without repo: Default to `just-bash`
3. **Conditional options**: `hybrid` requires a repo, so it's disabled when no repo is selected

## Sandbox Types

| Type | Display Name | Description |
|------|-------------|-------------|
| `hybrid` | Hybrid | Starts fast, upgrades to full VM. Best for most tasks. |
| `vercel` | Full VM | Direct Vercel VM with git/npm support. Slower startup. |
| `just-bash` | Memory Only | In-memory sandbox. No git, network, or npm. |

## Implementation Steps

### 1. Create sandbox type constants
**File**: `apps/web/lib/sandbox.ts` (NEW)
- Define `SandboxType` type and `SANDBOX_TYPES` array
- Define `SANDBOX_TYPE_OPTIONS` with display names and descriptions
- Helper functions: `getSandboxTypeOption()`, `getDefaultSandboxType(hasRepo)`

### 2. Create SandboxSelectorCompact component
**File**: `apps/web/components/sandbox-selector-compact.tsx` (NEW)
- Follow `ModelSelectorCompact` pattern (Popover + Command)
- Props: `value`, `onChange`, `hasRepo`
- Disable `hybrid` option when `hasRepo` is false
- Show "default" badge on hybrid option

### 3. Update TaskInput component
**File**: `apps/web/components/task-input.tsx`
- Add `selectedSandboxType` state
- Auto-update default when repo selection changes
- Add `SandboxSelectorCompact` to toolbar (after branch selector)
- Include `sandboxType` in `onSubmit` payload

### 4. Update database schema
**File**: `apps/web/lib/db/schema.ts`
- Add `sandboxType` column: `text("sandbox_type", { enum: ["hybrid", "vercel", "just-bash"] }).default("hybrid")`

### 5. Update tasks API
**File**: `apps/web/app/api/tasks/route.ts`
- Accept `sandboxType` in request body
- Store in task record (default to `"hybrid"`)

### 6. Update sandbox creation API
**File**: `apps/web/app/api/sandbox/route.ts`
- Read `sandboxType` from task record instead of auto-detecting
- Add explicit handling for `just-bash` type
- Keep backwards compatibility for tasks without `sandboxType`

### 7. Update task creation flow
**Files**:
- `apps/web/app/page.tsx` - Pass `sandboxType` through
- `apps/web/hooks/use-tasks.ts` - Add to `CreateTaskInput` interface

## Files to Modify

| File | Action |
|------|--------|
| `apps/web/lib/sandbox.ts` | CREATE |
| `apps/web/components/sandbox-selector-compact.tsx` | CREATE |
| `apps/web/components/task-input.tsx` | MODIFY |
| `apps/web/lib/db/schema.ts` | MODIFY |
| `apps/web/app/api/tasks/route.ts` | MODIFY |
| `apps/web/app/api/sandbox/route.ts` | MODIFY |
| `apps/web/app/page.tsx` | MODIFY |
| `apps/web/hooks/use-tasks.ts` | MODIFY |

## Database Migration

```sql
ALTER TABLE tasks ADD COLUMN sandbox_type TEXT DEFAULT 'hybrid';
```

## Verification

1. **UI Test**: Create a new task, verify sandbox selector appears in toolbar
2. **Default behavior**: Verify default changes when repo is selected/deselected
3. **Hybrid disabled**: Verify hybrid option is disabled when no repo selected
4. **Task creation**: Create tasks with each sandbox type, verify stored correctly
5. **Sandbox creation**: Start a task, verify correct sandbox type is created
6. **Backwards compatibility**: Existing tasks (null sandboxType) should default to hybrid behavior
