# Diff Viewer Implementation Plan

## Overview

The diff viewer shows users all changes made by the agent in real-time, comparing the current sandbox state against HEAD (essentially all staged + unstaged changes).

**Data Flow:**
```
Agent modifies files -> Tool completes -> refreshKey++ -> DiffViewer fetches -> Git commands run -> UI updates
```

The key insight is that it's not polling continuously - it only refreshes when the agent actually modifies something, keeping it efficient while staying up-to-date.

---

## 1. API Route: `/api/tasks/[taskId]/diff`

**Location:** `apps/web/app/api/tasks/[id]/diff/route.ts`

### Responsibilities

- Validate sandbox is active via `sandboxId` query param
- Run `git diff HEAD` for full unified diff
- Run `git diff HEAD --stat` for file statistics
- Run `git diff HEAD --name-status` for file status (A/M/D/R)
- Parse output into structured response

### Response Schema

```typescript
type DiffFile = {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  diff: string; // Raw unified diff for this file
  oldPath?: string; // For renamed files
};

type DiffResponse = {
  files: DiffFile[];
  summary: {
    totalFiles: number;
    totalAdditions: number;
    totalDeletions: number;
  };
};
```

### Implementation Notes

- Follow pattern from `generate-pr/route.ts` - use `connectVercelSandbox({ sandboxId })`
- Parse `--stat` output for per-file stats (format: `filename | 10 ++++------`)
- Parse `--name-status` for file status:
  - `A` = added
  - `M` = modified
  - `D` = deleted
  - `R` = renamed (includes old path)
- Split full diff by file headers (`diff --git a/... b/...`)

### Example Git Commands

```bash
# Get file status
git diff HEAD --name-status

# Get stats per file
git diff HEAD --stat

# Get full unified diff
git diff HEAD
```

---

## 2. UI Component: `diff-viewer.tsx`

**Location:** `apps/web/app/tasks/[id]/diff-viewer.tsx`

### Component Structure

```
DiffViewer
├── Header
│   ├── Tabs (Diff | Logs)
│   ├── Window controls (split, close)
│   └── Total stats badge (+51 -0)
├── FileList
│   └── FileEntry (collapsible)
│       ├── Chevron
│       ├── File path
│       ├── Status badge (New/Modified/Deleted/Renamed)
│       ├── Per-file stats
│       └── Actions menu (optional)
└── ExpandedDiff (when file is expanded)
    ├── Line numbers gutter
    ├── +/- prefix column
    └── Code content with syntax highlighting
```

### Props Interface

```typescript
type DiffViewerProps = {
  sandboxId: string;
  refreshKey: number;
  onClose: () => void;
};
```

### Styling (based on reference image)

- Width: `w-[500px]` (matches existing placeholder)
- Dark theme with:
  - Green additions: `bg-green-950/50`, `text-green-500`
  - Red deletions: `bg-red-950/50`, `text-red-400`
- Monospace font for code: `font-mono text-xs`
- Border styling: `border-border`, `bg-card`
- Line numbers: gray gutter, right-aligned

### Existing Patterns to Reuse

- `createEditDiffLines` from `@open-agents/shared/lib/diff` - adapt for unified diff parsing
- Diff line rendering from `edit-renderer.tsx` (lines 101-144)
- Collapsible pattern from `edit-renderer.tsx`
- Shiki themes from `task-detail-content.tsx` (lines 49-52)

### States to Handle

1. **Loading** - Show skeleton/spinner while fetching
2. **Empty** - "No changes" message when working directory is clean
3. **Error** - Show error message (e.g., sandbox expired)
4. **Success** - Show file list and diffs

---

## 3. TaskContext Enhancement

**Location:** `apps/web/app/tasks/[id]/task-context.tsx`

### Changes Required

Add to `TaskChatContextValue`:

```typescript
type TaskChatContextValue = {
  // ... existing fields
  diffRefreshKey: number;
  triggerDiffRefresh: () => void;
};
```

### Implementation

```typescript
const [diffRefreshKey, setDiffRefreshKey] = useState(0);

const triggerDiffRefresh = useCallback(() => {
  setDiffRefreshKey((prev) => prev + 1);
}, []);
```

---

## 4. Smart Refresh Trigger

**Location:** `apps/web/app/tasks/[id]/task-detail-content.tsx`

### Tool Types to Watch

- `write` - file creation
- `edit` - file modification  
- `bash` - could modify files (git commands, mv, rm, etc.)

### Implementation

```typescript
// Track completed tool operations to trigger diff refresh
const prevToolStatesRef = useRef<Map<string, string>>(new Map());

useEffect(() => {
  const currentToolStates = new Map<string, string>();
  let shouldRefresh = false;

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    
    for (const part of message.parts) {
      if (!isToolUIPart(part)) continue;
      
      const toolId = part.id;
      const toolState = part.state;
      currentToolStates.set(toolId, toolState);
      
      // Check if this tool just completed
      const prevState = prevToolStatesRef.current.get(toolId);
      const isFileModifyingTool = ["write", "edit", "bash"].includes(part.toolName);
      const justCompleted = 
        toolState === "output-available" && 
        prevState !== "output-available";
      
      if (isFileModifyingTool && justCompleted) {
        shouldRefresh = true;
      }
    }
  }

  prevToolStatesRef.current = currentToolStates;
  
  if (shouldRefresh) {
    triggerDiffRefresh();
  }
}, [messages, triggerDiffRefresh]);
```

---

## 5. Integration Points

### task-detail-content.tsx

Replace placeholder (lines 564-594) with:

```tsx
{showDiffPanel && sandboxInfo && (
  <DiffViewer
    sandboxId={sandboxInfo.sandboxId}
    refreshKey={diffRefreshKey}
    onClose={() => setShowDiffPanel(false)}
  />
)}
```

### Add button to open diff panel

Add to header actions (around line 296):

```tsx
<Button
  variant="ghost"
  size="sm"
  onClick={() => setShowDiffPanel(!showDiffPanel)}
>
  <GitCompare className="mr-2 h-4 w-4" />
  Diff
</Button>
```

---

## 6. File Structure

```
apps/web/
├── app/
│   ├── api/
│   │   └── tasks/
│   │       └── [id]/
│   │           └── diff/
│   │               └── route.ts          # NEW: Diff API endpoint
│   └── tasks/
│       └── [id]/
│           ├── task-context.tsx          # MODIFY: Add diffRefreshKey
│           ├── task-detail-content.tsx   # MODIFY: Integrate DiffViewer
│           └── diff-viewer.tsx           # NEW: Main diff viewer component
```

---

## 7. Open Questions

These should be answered before implementation:

1. **Logs Tab** - Should the "Logs" tab be implemented now, or left as a placeholder? What logs would it show - agent execution logs, sandbox shell output?

2. **Syntax Highlighting** - The existing codebase uses Shiki via Streamdown. Should we reuse that setup, or is a simpler approach preferred? Full syntax highlighting adds complexity.

3. **File Actions Menu** - The reference image shows a three-dot menu on each file. What actions should be available? (e.g., "Copy path", "View file", "Revert changes"?)

4. **Empty State** - What should display when there are no changes (clean working directory)?

5. **Error Handling** - If the sandbox expires mid-session, should the diff panel show a "Sandbox expired" message with a reconnect option?

6. **Split/Full-screen Toggle** - The reference image shows window control icons. Should the panel support full-screen mode or split-view mode?

---

## 8. Implementation Order

1. **API Route** - Create `/api/tasks/[id]/diff/route.ts` with git commands and parsing
2. **TaskContext** - Add `diffRefreshKey` and `triggerDiffRefresh`
3. **DiffViewer Component** - Build the UI component with file list and diff rendering
4. **Integration** - Wire up in `task-detail-content.tsx`
5. **Smart Refresh** - Implement tool completion watching
6. **Polish** - Error states, loading states, empty states

---

## 9. Dependencies

No new dependencies required. Uses existing:

- `@open-agents/sandbox` for `connectVercelSandbox`
- `@open-agents/shared/lib/diff` for diff utilities
- `lucide-react` for icons
- Existing UI components (Button, etc.)

---

## 10. Testing Considerations

- Test with various diff scenarios:
  - New files only
  - Modified files only
  - Deleted files
  - Renamed files
  - Large diffs (100+ lines)
  - Binary files (should show placeholder)
- Test refresh mechanism with rapid tool executions
- Test sandbox expiry edge case
- Test with no changes (empty state)
