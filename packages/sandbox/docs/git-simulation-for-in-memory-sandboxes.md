# Git Simulation for In-Memory Sandboxes

> **Status**: Implemented but not shipped. See "When to Use This" section for applicability.

## Problem Statement

When running an agent in an in-memory sandbox (no real filesystem, no git), how do you show users what files the agent created or modified?

The web UI has a diff viewer that expects git-style output (`git diff HEAD`, `git status`, etc.). Cloud sandboxes have real git, but in-memory sandboxes don't. Without git simulation, the diff viewer shows nothing for in-memory sandbox work.

## When to Use This

This solution is appropriate when:

1. **The sandbox represents a changeset** - work that will be reviewed and applied elsewhere
2. **There's a meaningful "before" state** - users care about what changed, not just what exists
3. **The workflow ends with integration** - changes get committed, merged, or applied to real code

This solution is **NOT appropriate** when:

1. **The sandbox is a scratchpad** - files are the output, not changes to be applied
2. **The sandbox is for context offload** - agent writes intermediate results for its own reference
3. **There's no integration workflow** - nothing to do with the diff

For scratchpad/exploration use cases, a simple file browser is the right UI, not a diff viewer.

## Solution Architecture

### Core Concept

Simulate git by storing two snapshots:

1. **Baseline (initialFiles)** - the filesystem state when the sandbox was created
2. **Current (files)** - the filesystem state now

Git commands compute differences between these two snapshots rather than using actual git.

### Data Flow

```
Sandbox Creation
       │
       ▼
┌─────────────────────────────────────┐
│  Snapshot initial filesystem state  │
│  Store as `baseline` (in-memory)    │
│  Store as `initialFiles` (persist)  │
└─────────────────────────────────────┘
       │
       ▼
Agent makes file changes (write, edit, delete)
       │
       ▼
┌─────────────────────────────────────┐
│  Agent runs `git diff HEAD`         │
│  Simulated git compares:            │
│    current fs state vs baseline     │
│  Returns unified diff format        │
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  Sandbox state persisted:           │
│  - files: current state             │
│  - initialFiles: original baseline  │
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  Sandbox restored from state:       │
│  - Recreate fs from `files`         │
│  - Restore baseline from            │
│    `initialFiles`                   │
│  - Diff still works correctly       │
└─────────────────────────────────────┘
```

### Key Insight: Baseline Persistence

The tricky part is maintaining the baseline across sessions. Without `initialFiles`:

- Session 1: Agent creates `foo.ts` → diff shows `+foo.ts`
- Session 2: Sandbox restored from `files` only → baseline = current state → diff shows nothing

With `initialFiles`:

- Session 1: Agent creates `foo.ts` → diff shows `+foo.ts`
- Session 2: Sandbox restored, baseline restored from `initialFiles` → diff still shows `+foo.ts`

## Implementation Details

### State Schema

```typescript
interface JustBashState {
  // Current filesystem state
  files?: Record<string, FileEntry>;

  // Original baseline for diff computation
  // If absent, `files` is used as baseline (no changes detected)
  initialFiles?: Record<string, FileEntry>;

  workingDirectory?: string;
  env?: Record<string, string>;
}

interface FileEntry {
  type: "file" | "directory" | "symlink";
  content?: string;
  encoding?: "base64";  // For binary files
  mode?: number;
  target?: string;      // For symlinks
}
```

### Filesystem Snapshot

The in-memory filesystem uses `Map<string, FsEntry>` where:

```typescript
interface FsEntry {
  type: "file" | "directory" | "symlink";
  content?: Uint8Array;  // Raw bytes for files
  mode?: number;
  target?: string;
}
```

Snapshotting creates a deep copy to prevent mutations from affecting the baseline:

```typescript
function snapshotFilesystem(fsData: Map<string, FsEntry>): FilesystemSnapshot {
  const snapshot = new Map<string, FsEntry>();
  for (const [path, entry] of fsData) {
    snapshot.set(path, {
      type: entry.type,
      content: entry.content ? new Uint8Array(entry.content) : undefined,
      mode: entry.mode,
      target: entry.target,
    });
  }
  return snapshot;
}
```

### Change Detection

Compare current filesystem against baseline:

```typescript
function computeChanges(currentFs, baseline, workingDirectory): FileChange[] {
  const changes = [];
  const seen = new Set();

  // Find new and modified files
  for (const [path, entry] of currentFs) {
    if (!path.startsWith(workingDirectory)) continue;
    if (entry.type !== "file") continue;

    seen.add(path);
    const baselineEntry = baseline.get(path);

    if (!baselineEntry) {
      changes.push({ path, status: "A", newContent: decode(entry.content) });
    } else if (decode(entry.content) !== decode(baselineEntry.content)) {
      changes.push({
        path,
        status: "M",
        oldContent: decode(baselineEntry.content),
        newContent: decode(entry.content)
      });
    }
  }

  // Find deleted files
  for (const [path, entry] of baseline) {
    if (!path.startsWith(workingDirectory)) continue;
    if (entry.type !== "file") continue;
    if (seen.has(path)) continue;

    changes.push({ path, status: "D", oldContent: decode(entry.content) });
  }

  return changes;
}
```

### Simulated Git Commands

Register a custom command handler in the shell:

```typescript
bash.registerCommand(createGitCommand(baseline, workingDirectory));
```

Supported commands:

| Command | Output |
|---------|--------|
| `git diff HEAD` | Unified diff format |
| `git diff HEAD --name-status` | `M\tpath` or `A\tpath` format |
| `git diff HEAD --numstat` | `additions\tdeletions\tpath` format |
| `git status` | Working tree status |
| `git ls-files --others` | Untracked (new) files |

Unsupported commands return an error explaining they require a cloud sandbox.

### Unified Diff Generation

For modified files, generate standard unified diff format:

```typescript
function generateUnifiedDiff(change: FileChange): string {
  const path = normalizePath(change.path);

  if (change.status === "A") {
    return `diff --git a/${path} b/${path}
new file mode 100644
--- /dev/null
+++ b/${path}
@@ -0,0 +1,${lineCount} @@
${lines.map(l => `+${l}`).join('\n')}`;
  }

  if (change.status === "D") {
    return `diff --git a/${path} b/${path}
deleted file mode 100644
--- a/${path}
+++ /dev/null
@@ -1,${lineCount} +0,0 @@
${lines.map(l => `-${l}`).join('\n')}`;
  }

  // Modified: show all old lines removed, all new lines added
  // (simplified diff, not optimal LCS-based)
  return `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -1,${oldLineCount} +1,${newLineCount} @@
${oldLines.map(l => `-${l}`).join('\n')}
${newLines.map(l => `+${l}`).join('\n')}`;
}
```

Note: This generates a simplified diff (full replacement) rather than computing the optimal longest common subsequence. Good enough for review purposes.

### Serialization for Persistence

Convert between in-memory format (`Map<string, FsEntry>` with `Uint8Array`) and persistence format (`Record<string, FileEntry>` with strings):

```typescript
// Serialize: Map → Record (for JSON storage)
function serializeFilesystemSnapshot(snapshot, workingDirectory) {
  const result = {};
  for (const [path, entry] of snapshot) {
    if (!path.startsWith(workingDirectory)) continue;

    if (entry.type === "file" && entry.content) {
      try {
        // Try UTF-8 text
        const content = new TextDecoder("utf-8", { fatal: true }).decode(entry.content);
        result[path] = { type: "file", content, mode: entry.mode };
      } catch {
        // Binary → base64
        result[path] = {
          type: "file",
          content: Buffer.from(entry.content).toString("base64"),
          encoding: "base64",
          mode: entry.mode
        };
      }
    }
    // ... handle directory, symlink
  }
  return result;
}

// Deserialize: Record → Map (for restoration)
function deserializeFilesystemSnapshot(files) {
  const result = new Map();
  for (const [path, entry] of Object.entries(files)) {
    if (entry.type === "file" && entry.content) {
      const content = entry.encoding === "base64"
        ? new Uint8Array(Buffer.from(entry.content, "base64"))
        : new TextEncoder().encode(entry.content);
      result.set(path, { type: "file", content, mode: entry.mode ?? 0o644 });
    }
    // ... handle directory, symlink
  }
  return result;
}
```

## Files Involved

- `packages/sandbox/just-bash/git-command.ts` - Git command simulation
- `packages/sandbox/just-bash/sandbox.ts` - Baseline management, serialization
- `packages/sandbox/just-bash/state.ts` - State schema with `initialFiles`
- `packages/sandbox/just-bash/snapshot.ts` - Snapshot schema with `initialFiles`
- `packages/sandbox/hybrid/state.ts` - Hybrid state schema (passes through)
- `packages/sandbox/hybrid/sandbox.ts` - Hybrid serialization (passes through)
- `packages/sandbox/hybrid/connect.ts` - Hybrid connection (passes through)

## Open Questions

1. **When should the baseline reset?** Currently it's set once at sandbox creation and persisted forever. For long-running tasks, this might not be ideal.

2. **Diff algorithm quality**: The current implementation shows full file replacement rather than minimal diffs. For large files with small changes, this is noisy.

3. **Binary file handling**: Currently just shows "Binary files differ". Could show hex dump or other representation.

## Decision: Not Shipping for JustBash

After analysis, we decided this approach doesn't fit the JustBash use case:

- JustBash is a **scratchpad**, not a staging area
- Files are the output, not changes to be integrated
- Users don't need to know "what changed" - they need to see "what exists"
- A file browser is the appropriate UI, not a diff viewer

This documentation is preserved for future use cases where git simulation would be appropriate (e.g., a sandboxed environment where changes will be applied to a real codebase).
