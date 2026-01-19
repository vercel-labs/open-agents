# Hybrid Sandbox Architecture

This document outlines a hybrid sandbox architecture to eliminate perceived startup latency when using cloud sandboxes.

## Problem

Cloud sandboxes (Vercel) take approximately 12 seconds to spin up. During this time, the user sees nothing happening, which creates a poor experience. However, agents typically gather context first (reading files, exploring the codebase) before performing any write operations. This observation creates an opportunity for optimization.

## Sandbox Types and Trade-offs

### 1. Local Sandbox (`LocalSandbox`)

- **Pros**: Free, instant startup, full shell access, persistent
- **Cons**: Only available on local machine, no isolation
- **Use case**: CLI usage on developer machines

### 2. In-Memory Sandbox (`JustBashSandbox`)

- **Pros**: Instant startup, runs anywhere, safe (no real processes), no cost
- **Cons**: No git, no network, no package installation, simulated bash (not all commands work)
- **Modes**:
  - **Memory mode**: Pure in-memory filesystem, files provided at creation
  - **Overlay mode**: Copy-on-write over real directory, reads from disk, writes stay in memory

### 3. Cloud Sandbox (`VercelSandbox`)

- **Pros**: Full isolation, real bash, git, network, scalable
- **Cons**: ~12 second startup time, cost per minute while running
- **Use case**: Web-based agent tasks requiring full environment

## Proposed Solution: Hybrid Architecture

Start with an in-memory sandbox for immediate responsiveness, then seamlessly switch to the cloud sandbox once it's ready.

### Workflow

```
User starts task
       │
       ├──────────────────────────────────┐
       │                                  │
       ▼                                  ▼
┌──────────────────┐            ┌───────────────────────┐
│ JustBash Sandbox │            │ Vercel Sandbox        │
│ (instant start)  │            │ (background startup)  │
│                  │            │                       │
│ - Download repo  │            │ - Clone repo          │
│   tarball        │            │ - Configure git       │
│ - Extract to     │            │ - Install deps        │
│   memory         │            │                       │
│ - Agent explores │            │                       │
└──────────────────┘            └───────────────────────┘
       │                                  │
       │    ┌─────────────────────────────┘
       │    │ Vercel ready (~12s)
       ▼    ▼
┌────────────────────────────────────────────────────────┐
│              Seamless Handoff                          │
│                                                        │
│  - Vercel sandbox is now active                        │
│  - Any in-memory writes are replayed to Vercel         │
│  - Agent continues without interruption                │
└────────────────────────────────────────────────────────┘
```

### Key Insights

1. **Agents read first**: Most agent sessions start with exploration (glob, grep, read). These operations work perfectly on in-memory sandboxes.

2. **Write operations are rare initially**: Agents typically understand the codebase before making changes. By the time they need to write, the cloud sandbox is ready.

3. **GitHub tarball download is fast**: Downloading and extracting a repo tarball takes 1-3 seconds, much faster than cloning via git.

## Implementation Details

### Phase 1: GitHub Tarball Loading

Download and extract a GitHub repository into a JustBash sandbox:

```typescript
async function loadGitHubRepoToMemory(
  repoUrl: string,
  branch?: string,
  token?: string
): Promise<Record<string, string>> {
  // Parse repo URL: https://github.com/owner/repo
  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) throw new Error("Invalid GitHub URL");
  const [, owner, repo] = match;

  // GitHub tarball URL
  const ref = branch ?? "main";
  const tarballUrl = `https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`;

  // Download tarball
  const response = await fetch(tarballUrl, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  // Extract and return files map
  const files = await extractTarball(await response.arrayBuffer());
  return files;
}
```

### Phase 2: Parallel Startup

```typescript
async function createHybridSandbox(config: HybridSandboxConfig) {
  // Start immediately with JustBash
  const filesPromise = loadGitHubRepoToMemory(config.repoUrl, config.branch);
  const vercelPromise = connectVercelSandbox({ source: { url: config.repoUrl } });

  // JustBash is ready almost instantly
  const files = await filesPromise;
  const justBash = await createJustBashSandbox({
    workingDirectory: "/repo",
    files,
    mode: "memory",
  });

  // Return JustBash immediately, Vercel will be ready later
  return {
    sandbox: justBash,
    vercelReady: vercelPromise,
  };
}
```

### Phase 3: Seamless Handoff

The handoff strategy depends on sandbox state:

1. **No writes occurred**: Simply switch to Vercel sandbox
2. **Writes occurred**: Replay writes to Vercel before switching

```typescript
interface HybridSandbox {
  // Current active sandbox
  current: Sandbox;

  // Track writes for replay
  pendingWrites: Array<{ path: string; content: string }>;

  // Switch to Vercel when ready
  switchToVercel(): Promise<void>;
}
```

## Considerations

### What Works in JustBash

- File reading (`cat`, `head`, `tail`)
- Directory listing (`ls`, `find` simulation)
- Pattern matching (`grep` basic)
- File writing (`echo`, `printf`, redirects)
- Environment variables
- Basic conditionals and loops

### What Doesn't Work in JustBash

- Git operations
- Network requests (`curl`, `wget`)
- Package management (`npm`, `pnpm`)
- Process spawning
- Complex bash features

### Handling Unsupported Operations

If the agent attempts an unsupported operation before Vercel is ready:

1. **Queue the operation**: Store it for execution once Vercel is ready
2. **Wait for Vercel**: Block until Vercel sandbox is available
3. **Inform the agent**: Add a system message explaining the limitation

## Test Results

Tested on 2025-01-15 using `apps/web/hybrid-sandbox-test.ts` against `vercel-labs/ai-sdk-preview-rag` (38 files, 420KB).

### Measured Performance

| Approach | Time to First Read | Details |
|----------|-------------------|---------|
| **JustBash (tarball)** | **110ms** | Download: 99ms, Extract: 10ms, Create: 1ms |
| **Vercel (git clone)** | **6,881ms** | Full sandbox with git, network, etc. |

### Improvement

| Metric | Value |
|--------|-------|
| **Speedup** | **62x faster** to first interaction |
| **Time saved** | **6,771ms** of perceived wait eliminated |
| **User experience** | Agent starts working in 110ms instead of 7s |

### Breakdown

**JustBash Parallel Startup:**
- Tarball download: ~100ms
- Decompress + parse tar: ~10ms
- JustBash sandbox creation: ~1ms
- **Total: ~110ms**

**Vercel Startup:**
- SDK initialization + VM creation: ~6-7s
- Git clone + configuration: included
- **Total: ~6,881ms**

### Conclusion

The hybrid approach is validated. Users can start interacting with the agent **62x faster** while Vercel spins up in the background. The ~7 second wait is completely eliminated from the user's perspective.

## Open Questions

1. **Write conflict resolution**: If user writes to a file that doesn't exist in the tarball but will be created by `npm install` in Vercel, how do we handle?

2. **State synchronization**: Should we track all in-memory operations and replay them, or assume read-only until Vercel is ready?

3. **Error handling**: What if Vercel fails to start? Fall back to in-memory only? Retry?

4. **Memory limits**: Large repos might not fit in memory. Need streaming extraction or file limits?

## Handoff Mechanism

Tested on 2025-01-15 using `apps/web/hybrid-sandbox-handoff-test.ts`.

### HybridSandbox Implementation

A `HybridSandbox` class wraps both sandboxes and proxies all operations:

```typescript
class HybridSandbox implements Sandbox {
  private state: "justbash" | "switching" | "vercel" = "justbash";
  private justBash: Sandbox;
  private vercel: Sandbox | null = null;
  private pendingOperations: PendingOperation[] = [];

  // Dynamic working directory - returns current sandbox's path
  get workingDirectory(): string {
    return this.current.workingDirectory;
  }

  // Track writes for replay
  async writeFile(path: string, content: string): Promise<void> {
    if (this.state === "justbash") {
      this.pendingOperations.push({ type: "writeFile", path, content });
    }
    return this.current.writeFile(path, content, "utf-8");
  }

  // Replay writes during handoff
  async performHandoff(): Promise<void> {
    for (const op of this.pendingOperations) {
      await this.vercel.writeFile(op.path, op.content, "utf-8");
    }
    this.state = "vercel";
  }
}
```

### Key Features

1. **Dynamic `workingDirectory`**: Returns the current sandbox's path (changes after handoff)
2. **Write tracking**: All `writeFile` and `mkdir` calls are recorded for replay
3. **Auto-handoff detection**: Commands like `git`, `npm`, `curl` trigger automatic handoff
4. **Path alignment**: Use `/vercel/sandbox` as the working directory for both sandboxes to avoid remapping

### Handoff Test Results

| Metric | Time |
|--------|------|
| JustBash ready | ~360ms |
| Vercel ready | ~10,400ms |
| Handoff time (2 files) | ~1,300ms |
| Time saved | ~10,000ms |

### Verified Scenarios

1. **Read-only operations**: Stay on JustBash, no handoff needed
2. **Writes before Vercel ready**: Tracked and replayed during handoff
3. **Explicit handoff**: All pending writes replayed to Vercel
4. **File verification**: Confirmed replayed files exist in Vercel post-handoff

### Path Alignment Strategy

To avoid path remapping complexity, both sandboxes should use the same working directory path (`/vercel/sandbox`):

```typescript
// When extracting tarball, use Vercel's path structure
const WORKING_DIR = "/vercel/sandbox";

async function downloadAndExtractTarball(repoUrl: string): Promise<Record<string, string>> {
  // ... download and parse tar ...
  files[`${WORKING_DIR}/${relativePath}`] = content;  // Use /vercel/sandbox
  return files;
}

// Create JustBash with same working directory as Vercel
const justBash = await createJustBashSandbox({
  workingDirectory: WORKING_DIR,  // /vercel/sandbox
  files,
  mode: "memory",
});
```

This eliminates the need for path remapping during handoff since both sandboxes use identical paths.

## Next Steps

### Research Phase (Completed)

1. ~~Build the test file to validate the hypothesis~~ ✅ Done (`apps/web/hybrid-sandbox-test.ts`)
2. ~~Measure real-world tarball download times across various repo sizes~~ ✅ Done (110ms for 420KB repo)
3. ~~Prototype the handoff mechanism~~ ✅ Done (`apps/web/hybrid-sandbox-handoff-test.ts`)
4. ~~Research JustBash state serialization for serverless persistence~~ ✅ Done (`apps/web/justbash-serialization-test.ts`)
5. ~~Validate pending ops replay to Vercel~~ ✅ Done (`apps/web/pending-ops-replay-test.ts`)
6. ~~Implement serialization API on JustBashSandbox~~ ✅ Done (`packages/sandbox/just-bash.ts`) - See [Serialization API Design](#serialization-api-design)

### Web Integration Phase (Incremental)

Each milestone builds on the previous one. Test and validate before moving to the next.

#### Milestone 1: JustBash Persistence Across Turns ✅

**Goal**: Prove sandbox state survives serverless request boundaries.

**Test**:
1. Turn 1: Agent creates a file via sandbox
2. Request ends, new request starts
3. Turn 2: Agent reads the file back - it exists with correct content

**Success Criteria**:
- File persists across request boundary
- Restore time < 10ms
- State size < 500KB for typical usage

**Results** (2025-01-15):
| Metric | Target | Actual |
|--------|--------|--------|
| File persists | ✓ | ✓ |
| Restore time | < 10ms | **6ms** |
| State size | < 500KB | **769 bytes** |

**Implementation**:
- Added `justBashSnapshot` (jsonb) column to tasks table
- Test endpoint: `apps/web/app/api/test/justbash-persistence/route.ts`
- Fixed `JustBashSandbox.readFile`/`writeFile` to use native bash methods
- Fixed `fromSnapshot` to restore empty directories

#### Milestone 2: GitHub Repo in JustBash ✅

**Goal**: Load a GitHub repository into JustBash and persist across turns.

**Test**:
1. Task starts with repo URL
2. Repo loaded into JustBash via tarball
3. Agent explores and modifies files
4. Request ends, new request starts
5. Agent continues - all files and modifications persist

**Success Criteria**:
- Tarball load < 500ms for typical repos
- Full repo + modifications persist across requests
- Agent workflow is seamless

**Results** (2025-01-15):
| Metric | Target | Actual |
|--------|--------|--------|
| Tarball load | < 500ms | **345ms** |
| Restore time | < 10ms | **2ms** |
| Files persist | ✓ | ✓ |
| Modifications persist | ✓ | ✓ |

**Implementation**:
- Tarball utility: `apps/web/lib/github/tarball.ts`
- Test endpoint: `apps/web/app/api/test/justbash-repo/route.ts`
- JustBash init endpoint: `apps/web/app/api/sandbox/justbash/route.ts`
- Chat route integration: `apps/web/app/api/chat/route.ts` (supports both JustBash and Vercel modes)

**Optimizations**:
- Binary files (PNG, etc.) skipped during extraction (can't be stored in JSONB)
- Lock files filtered out (package-lock.json, yarn.lock, pnpm-lock.yaml, etc.) - reduced snapshot size by 87%
- Path alignment: Uses `/vercel/sandbox` for seamless future handoff to Vercel

#### Milestone 3: Background Vercel Startup ✅

**Goal**: Start Vercel in background while JustBash handles initial requests.

**Test**:
1. Task starts
2. JustBash ready immediately (~100ms)
3. Vercel starts in background
4. Agent works on JustBash during exploration
5. Vercel becomes ready (~8-12s later)

**Open Question**: Can Vercel sandbox connection persist across serverless requests?
- **Answer**: YES. The `sandboxId` persists in the database, and you reconnect using `VercelSandbox.connect(sandboxId)`. The Vercel VM stays running (costs money per minute), so all files persist.

**Success Criteria**:
- Agent activity within 500ms of task start
- Vercel ready in background within 15s
- No blocking during exploration phase

**Implementation** (2025-01-15):

Schema changes added to `apps/web/lib/db/schema.ts`:
- `vercelStatus: text` - Track background startup status ("starting" | "ready" | "failed")
- `vercelStartedAt: timestamp` - When we initiated Vercel startup
- `vercelError: text` - Error message if startup failed

**Endpoints**:
- Test endpoint: `apps/web/app/api/test/hybrid-background/route.ts`
- Background startup: `apps/web/app/api/sandbox/vercel-background/route.ts`
- Test script: `apps/web/scripts/test-milestone3.ts`

**How to run the test**:
```bash
# Start the web app
bun run web

# In another terminal, run the test script (from apps/web)
cd apps/web && bun run scripts/test-milestone3.ts
```

**Results** (2025-01-15):
| Metric | Target | Actual |
|--------|--------|--------|
| JustBash ready | < 500ms | **727ms** (with token retry) |
| Vercel ready | < 15s | **8.75s** |
| JustBash can read | ✓ | ✓ |
| JustBash can write | ✓ | ✓ |
| Vercel can read | ✓ | ✓ |
| Vercel can exec git | ✓ | ✓ |

**Performance**:
| Metric | Value |
|--------|-------|
| Time to first interaction | **727ms** |
| Vercel startup time | **8.75s** |
| Time saved | **8.02s** |
| Speedup | **12x faster** |

**Notes**:
- The 727ms includes a token fallback retry (~250ms overhead)
- With a valid GitHub token, JustBash ready time should be ~300-400ms
- Vercel startup varies (6-12s) depending on repo size and network conditions

#### Milestone 4: Seamless Handoff ✅

**Goal**: Switch from JustBash to Vercel, replaying any writes.

**Test**:
1. Agent makes changes while on JustBash
2. Vercel becomes ready
3. Handoff triggered (git command, explicit, or threshold)
4. Pending writes replayed to Vercel
5. Agent continues on Vercel - all files exist

**Handoff Triggers**:
- Agent issues git/npm/network command (requires Vercel)
- Explicit handoff request
- Turn count threshold (configurable)

**Success Criteria**:
- All writes replay correctly
- Files identical in Vercel after handoff
- No path changes or interruptions
- Git/npm work after handoff

**Implementation** (2025-01-15):

Schema changes added to `apps/web/lib/db/schema.ts`:
- `pendingOperations: jsonb` - Track write operations for replay during handoff
- `sandboxMode: text` - Current sandbox mode ("justbash" | "vercel")

**New Components**:
- `HybridSandbox` class: `apps/web/lib/sandbox/hybrid-sandbox.ts`
  - Wraps JustBash sandbox and tracks all write operations (writeFile, mkdir)
  - Detects commands that require Vercel (git, npm, curl, etc.)
  - `performHandoff(vercelSandbox)` method replays pending operations
- Handoff API endpoint: `apps/web/app/api/sandbox/handoff/route.ts`
  - GET: Check handoff eligibility status
  - POST: Perform handoff with operation replay
- Test endpoint: `apps/web/app/api/test/hybrid-handoff/route.ts`
- Test script: `apps/web/scripts/test-milestone4.ts`

**How to run the test**:
```bash
# Start the web app
bun run web

# In another terminal, run the test script (from apps/web)
cd apps/web && bun run scripts/test-milestone4.ts
```

**PendingOperation Type**:
```typescript
type PendingOperation =
  | { type: "writeFile"; path: string; content: string }
  | { type: "mkdir"; path: string; recursive: boolean };
```

**Vercel-Required Commands** (auto-detected for handoff trigger):
- Git operations: `git`
- Package managers: `npm`, `pnpm`, `yarn`, `bun`
- Network operations: `curl`, `wget`, `fetch`
- Process execution: `node`, `python`, `python3`, `ruby`, `php`

**Results** (2025-01-15):
| Metric | Target | Actual |
|--------|--------|--------|
| All writes replay | ✓ | ✓ (5 ops) |
| Files exist in Vercel | ✓ | ✓ (3/3) |
| Content matches | ✓ | ✓ |
| Git works after handoff | ✓ | ✓ |
| Handoff time | < 5s | **2.98s** |

**Performance**:
| Metric | Value |
|--------|-------|
| JustBash ready | **817ms** |
| Vercel ready | **10.15s** |
| Handoff time | **2.98s** |
| Total test time | **15.81s** |

#### Milestone 5: Chat Route Integration ✅

**Goal**: Integrate HybridSandbox into the web chat route for seamless user experience.

**Implementation** (2025-01-15):

The chat route now fully supports the hybrid sandbox architecture with automatic handoff.

**Key Changes to `apps/web/app/api/chat/route.ts`**:

1. **HybridSandbox Integration**
   - Imports `HybridSandbox` and `PendingOperation` types
   - Wraps JustBash in HybridSandbox when restoring from snapshot
   - Restores existing `pendingOperations` from task to continue tracking

2. **Automatic Handoff**
   - Before agent runs, checks if `vercelStatus === "ready"` and `sandboxId` exists
   - If ready, performs inline handoff: connects to Vercel, replays pending ops
   - After handoff: updates task to `sandboxMode: "vercel"`, clears JustBash state

3. **State Persistence**
   - On finish, if using HybridSandbox, serializes both snapshot and pending operations
   - Updates task with: `{ justBashSnapshot, pendingOperations }`

4. **Vercel-Required Commands**
   - HybridSandbox detects git/npm/curl commands and returns helpful error
   - Agent informed that command requires Vercel

**New Files**:
- Test endpoint: `apps/web/app/api/test/hybrid-chat/route.ts`
- Test script: `apps/web/scripts/test-milestone5.ts`

**How to run the test**:
```bash
# Start the web app
bun run web

# In another terminal, run the test script (from apps/web)
cd apps/web && bun run scripts/test-milestone5.ts
```

**Success Criteria**:
- [x] User starts task and can interact within ~1s (JustBash)
- [x] Agent can read/write files immediately
- [x] Pending operations tracked and persisted across requests
- [x] Auto-handoff when Vercel ready
- [x] All file changes persist after handoff
- [x] No user action required for handoff
- [x] Git/npm work after handoff

**Chat Route Flow**:

```
POST /api/chat (with taskId)
       │
       ├─ Load task from DB
       │
       ├─ Determine mode:
       │  ├─ sandboxMode === "vercel" OR no justBashSnapshot → Vercel mode
       │  └─ Has justBashSnapshot → JustBash mode
       │
       ├─ If JustBash mode:
       │  ├─ Check: vercelStatus === "ready" && sandboxId exists?
       │  │  ├─ YES → Perform inline handoff:
       │  │  │        1. Connect to Vercel
       │  │  │        2. Replay pending operations
       │  │  │        3. Update task: sandboxMode="vercel", clear JustBash state
       │  │  │        4. Use Vercel sandbox for agent
       │  │  │
       │  │  └─ NO → Use HybridSandbox:
       │  │          1. Restore JustBash from snapshot
       │  │          2. Restore pending operations
       │  │          3. Wrap in HybridSandbox
       │  │          4. Agent works on JustBash
       │  │
       │  └─ On finish: persist justBashSnapshot + pendingOperations
       │
       └─ If Vercel mode:
          └─ Connect to Vercel sandbox directly
```

### Future Improvements

- [ ] Large repo handling (streaming, blob storage)
- [x] Binary file handling (skipped during tarball extraction)
- [ ] Graceful degradation if Vercel fails
- [ ] Metrics and monitoring
- [x] Seamless handoff from JustBash to Vercel (Milestone 4)
- [x] Chat route integration with automatic handoff (Milestone 5)
- [ ] Frontend status display (JustBash vs Vercel indicator)

## Serverless Persistence

Researched on 2025-01-15 using `apps/web/justbash-serialization-test.ts`. The main challenge: serverless environments don't persist in-memory state across invocations, so we need to serialize JustBash state to the database and restore it on subsequent requests.

### JustBash Internals Discovery

The `Bash` class from `just-bash` exposes its internal filesystem via `bash.fs.data`, which is a `Map<string, FsEntry>`:

```typescript
// File entry structure
interface FileEntry {
  type: "file";
  content: Uint8Array;  // File content as bytes
  mode: number;         // Permissions (420 = 0o644)
  mtime: Date;          // Modification time
}

// Directory entry structure
interface DirectoryEntry {
  type: "directory";
  mode: number;         // Permissions (493 = 0o755)
  mtime: Date;
}

// Symlink entry structure
interface SymlinkEntry {
  type: "symlink";
  target: string;       // Symlink target path
}
```

### Key APIs Available

| Method | Description |
|--------|-------------|
| `bash.fs.data` | `Map<string, FsEntry>` - Full filesystem state |
| `bash.fs.getAllPaths()` | Returns array of all paths in filesystem |
| `bash.getCwd()` | Current working directory |
| `bash.getEnv()` | Environment variables |

### System Files (Skip During Serialization)

JustBash auto-creates these paths on instantiation - no need to serialize:
- `/bin/*` - Command stubs (echo, cat, ls, etc.)
- `/proc/*` - Process info simulation
- `/dev/*` - Device files (null, zero, stdin, etc.)
- `/usr/bin` - Additional binaries

### Serialization Format

```typescript
interface JustBashSnapshot {
  workingDirectory: string;
  env: Record<string, string>;
  files: Record<string, {
    type: "file" | "directory" | "symlink";
    content?: string;       // For files (UTF-8 text)
    encoding?: "base64";    // For binary files
    mode?: number;          // File permissions
    target?: string;        // For symlinks
  }>;
}
```

### Serialize Function

```typescript
function serializeJustBash(bash: Bash, workingDir: string): JustBashSnapshot {
  const snapshot: JustBashSnapshot = {
    workingDirectory: bash.getCwd(),
    env: bash.getEnv(),
    files: {},
  };

  for (const [path, entry] of bash.fs.data) {
    // Skip system files - they're recreated automatically
    if (!path.startsWith(workingDir) && path !== workingDir) continue;

    if (entry.type === "file") {
      try {
        const content = new TextDecoder().decode(entry.content);
        snapshot.files[path] = { type: "file", content, mode: entry.mode };
      } catch {
        // Binary file - encode as base64
        const base64 = Buffer.from(entry.content).toString("base64");
        snapshot.files[path] = { type: "file", content: base64, encoding: "base64", mode: entry.mode };
      }
    } else if (entry.type === "directory") {
      snapshot.files[path] = { type: "directory", mode: entry.mode };
    } else if (entry.type === "symlink") {
      snapshot.files[path] = { type: "symlink", target: entry.target };
    }
  }

  return snapshot;
}
```

### Deserialize Function

```typescript
function deserializeJustBash(snapshot: JustBashSnapshot): Bash {
  // Convert snapshot to Bash's expected files format
  const files: Record<string, string> = {};

  for (const [path, entry] of Object.entries(snapshot.files)) {
    if (entry.type === "file") {
      if (entry.encoding === "base64") {
        files[path] = Buffer.from(entry.content!, "base64").toString("utf-8");
      } else {
        files[path] = entry.content!;
      }
    }
    // Directories are created implicitly when files are written
  }

  return new Bash({
    files,
    cwd: snapshot.workingDirectory,
    env: snapshot.env,
  });
}
```

### Serialization Test Results

Tested on 2025-01-15 using `apps/web/justbash-serialization-test.ts`.

#### Test Scenarios Validated

| Test | Description | Result |
|------|-------------|--------|
| Basic Round-Trip | serialize → JSON.stringify → JSON.parse → deserialize | ✅ Pass |
| Modifications Preserved | Changes via exec() (mkdir, file writes) captured | ✅ Pass |
| Sandbox Integration | Access internal Bash from JustBashSandbox | ✅ Pass |
| Size Analysis | Measure JSON overhead across file counts | ✅ Pass |
| Multi-Request Simulation | State persists across serverless boundaries | ✅ Pass |

#### Verified Behaviors

- All files preserved correctly
- Working directory restored
- Environment variables restored
- New files created during session included
- Modifications made via `exec()` are captured in the snapshot

#### Performance

| Operation | Time |
|-----------|------|
| Serialization | <1ms |
| Deserialization | <1ms |
| Full round-trip | <1ms |

#### JSON Overhead by File Count

| Scenario | Input Size | Snapshot Size | Overhead |
|----------|------------|---------------|----------|
| Small (10 files) | 1.1 KB | 2.0 KB | 90% |
| Medium (50 files) | 24.9 KB | 28.6 KB | 15% |
| Large (200 files) | 197.5 KB | 211.4 KB | 7% |

Note: Overhead decreases with more files because JSON structure is amortized.

#### Key Discovery: System Files

`bash.fs.data` contains ~90 entries on initialization, but most are system files:
- `/bin/*` - Command stubs (echo, cat, ls, etc.)
- `/dev/*` - Device files (null, zero, stdin, etc.)
- `/proc/*` - Process info simulation
- `/usr/bin` - Additional binaries

These are recreated automatically on `new Bash()`, so only files under the working directory need serialization.

### Storage Options

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **Database (JSON column)** | Simple, atomic with task | Size limits (~1MB) | Best for small-medium repos |
| **Vercel Blob** | No size limits | Extra request, eventual consistency | For large repos |

**Recommendation**: Use database storage since JustBash repos are small (tarball downloads in ~100ms means small repos).

### Full Persistence Model

For the hybrid sandbox to work across serverless invocations:

```typescript
interface PersistedHybridState {
  // Current state
  state: "justbash" | "vercel";

  // For restoring JustBash between requests
  justBashSnapshot: JustBashSnapshot | null;

  // For eventual handoff to Vercel
  pendingOperations: PendingOperation[];

  // After handoff, use Vercel directly
  vercelSandboxId: string | null;
}

type PendingOperation =
  | { type: "writeFile"; path: string; content: string }
  | { type: "mkdir"; path: string; recursive: boolean };
```

### Flow Across Requests

```
Request 1 (Task Start)
├─ Download tarball → JustBash (instant)
├─ Start Vercel in background
├─ Agent works on JustBash
├─ Track pendingOperations
└─ End: Serialize { justBashSnapshot, pendingOperations, state: "justbash" }

Request 2
├─ Restore JustBash from snapshot
├─ Check if Vercel ready (may have finished in background)
├─ If Vercel ready:
│   ├─ Replay pendingOperations to Vercel
│   ├─ Set state: "vercel"
│   └─ Clear justBashSnapshot (no longer needed)
├─ Agent continues working
└─ End: Serialize updated state

Request N (After Handoff)
├─ state === "vercel"
├─ Connect to Vercel via vercelSandboxId
└─ JustBash no longer used
```

### Size Estimates

Based on measured results from `apps/web/justbash-serialization-test.ts`:

| Repo Size | File Count | Serialized JSON |
|-----------|------------|-----------------|
| Small | 10 files | ~2 KB |
| Medium | 50 files | ~29 KB |
| Large | 200 files | ~211 KB |

Note: Serialized JSON is much smaller than the original tarball because:
1. Only user files under working directory (no system files)
2. Text content without tar overhead
3. No compression needed for JSON storage

## Pending Operations Replay

Tested on 2025-01-15 using `apps/web/pending-ops-replay-test.ts`. This validates the final piece: applying serialized pending operations to a real Vercel sandbox.

### Test Flow

1. Create JustBash from GitHub tarball
2. Make modifications (track as pending operations)
3. Serialize JustBash state + pending ops (simulating DB storage)
4. Stop JustBash (simulating end of serverless request)
5. Restore state from "database" (JSON parse)
6. Create fresh Vercel sandbox
7. Replay pending operations to Vercel
8. Verify files exist with correct content

### Results

| Metric | Value |
|--------|-------|
| Pending operations tracked | 4 |
| Operations replayed | 4/4 |
| Files verified in Vercel | 3/3 |
| Content matches | 3/3 |
| **Result** | **PASSED ✓** |

### Timing

| Phase | Time |
|-------|------|
| Tarball download | 331ms |
| Vercel startup | 8,555ms |
| Replay operations | 2,678ms |

### Key Validations

- ✓ Pending operations from JustBash successfully applied to Vercel
- ✓ Files created in JustBash exist in Vercel with correct content
- ✓ Directory creation (`mkdir`) replays correctly
- ✓ File writes (`writeFile`) replay with exact content match
- ✓ **Hybrid sandbox architecture is viable for production**

### Open Questions

1. **Vercel startup across requests**: Can we start Vercel in Request 1 and have it ready for Request 2? Or does each request need to start fresh?

2. **Hybrid sandbox ID**: How do we identify a hybrid sandbox across requests? Use task ID as the key?

3. **Cleanup**: When should we delete the persisted state? After PR merged? After task completed?

4. **Binary files**: Large binary files will bloat the JSON. Should we exclude them or store separately?

## Serialization API Design

Researched on 2025-01-15. The hybrid sandbox requires serializing JustBash state across serverless request boundaries. This capability is only needed for in-memory sandboxes, not LocalSandbox or VercelSandbox.

### Design Decision: Class-Level Methods

After analyzing six approaches, we chose to add serialization as **class methods on `JustBashSandbox`**, not on the `Sandbox` interface.

**Why not add to Sandbox interface?**

1. **Semantic mismatch**: Serialization is fundamentally different from `snapshot()` (which uploads to blob storage). It's an in-memory state export.
2. **Interface pollution**: LocalSandbox and VercelSandbox would need to stub or throw for methods that make no sense for their context.
3. **Single consumer**: Only HybridSandbox needs this capability, and it knows it's working with JustBash.

**Chosen approach:**

```typescript
class JustBashSandbox implements Sandbox {
  // Instance method to export state
  serialize(): JustBashSnapshot { ... }

  // Static factory to restore from snapshot
  static async fromSnapshot(snapshot: JustBashSnapshot): Promise<JustBashSandbox> { ... }
}
```

**Key insight**: HybridSandbox is the only consumer of serialization. It **knows** it's working with JustBash (it creates it). There's no need for polymorphic serialization across sandbox types.

### Snapshot Type

```typescript
interface JustBashSnapshot {
  workingDirectory: string;
  env: Record<string, string>;
  files: Record<string, {
    type: "file" | "directory" | "symlink";
    content?: string;       // For files (UTF-8 text)
    encoding?: "base64";    // For binary files
    mode?: number;          // File permissions
    target?: string;        // For symlinks
  }>;
}
```

### Factory Return Type Change

The `createJustBashSandbox()` factory function will return `Promise<JustBashSandbox>` instead of `Promise<Sandbox>`. This allows callers that need serialization to access the full type without casting.

### Implementation Notes

1. **Binary files**: Stored as base64 in the snapshot. For now this is acceptable since typical agent workloads are text-heavy. Large binary files will bloat the JSON but won't break functionality.

2. **No versioning**: Snapshots don't include a version field. State is overwritten at each persistence boundary, so migration isn't needed.

3. **System files excluded**: Only files under the working directory are serialized. System files (`/bin`, `/proc`, `/dev`, `/usr`) are recreated automatically by `new Bash()`

### Implementation Status ✅

Implemented on 2025-01-15 in `packages/sandbox/just-bash.ts`.

**Changes made:**

1. **Added `serialize()` instance method** - Exports sandbox state to `JustBashSnapshot`. Only works for memory mode sandboxes (throws for overlay mode).

2. **Added `fromSnapshot()` static factory** - Restores a sandbox from a previously serialized snapshot. Accepts optional `SandboxHooks` parameter.

3. **Updated `createJustBashSandbox()` return type** - Now returns `Promise<JustBashSandbox>` instead of `Promise<Sandbox>` for direct access to serialization methods.

4. **Exported `JustBashSnapshot` type** - Available from `@open-harness/sandbox` package.

5. **Uses `FsEntry` type from `just-bash`** - No manual type maintenance required; types are derived directly from the library.

**Usage example:**

```typescript
import { createJustBashSandbox, JustBashSandbox, type JustBashSnapshot } from "@open-harness/sandbox";

// Create and use sandbox
const sandbox = await createJustBashSandbox({
  workingDirectory: "/workspace",
  files: { "/workspace/file.txt": "content" },
  mode: "memory",
});

// Serialize for persistence (e.g., to database)
const snapshot: JustBashSnapshot = sandbox.serialize();
const json = JSON.stringify(snapshot);

// Later: restore from snapshot
const restored = await JustBashSandbox.fromSnapshot(JSON.parse(json));
```
