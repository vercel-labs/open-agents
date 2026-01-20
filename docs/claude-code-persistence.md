# Claude Code Persistence System

A complete technical specification for implementing session persistence and resume functionality, reverse-engineered from Claude Code v2.1.12.

## Overview

Claude Code persists all conversation sessions locally, enabling users to resume previous conversations. Sessions are organized by project directory and are git-aware (supporting branch filtering and worktree grouping).

---

## Directory Structure

All persistence data lives under `~/.claude/`:

```
~/.claude/
├── projects/                    # Session transcripts organized by project
│   └── {encoded-path}/          # One directory per unique working directory
│       ├── {session-uuid}.jsonl # Main session transcript
│       ├── {session-uuid}/      # Session artifacts directory
│       │   ├── subagents/       # Subagent working data
│       │   └── tool-results/    # Large tool output storage
│       └── agent-{short-id}.jsonl  # Subagent transcripts
│
├── file-history/                # File version backups per session
│   └── {session-uuid}/
│       └── {file-hash}@v{n}     # Versioned file content
│
├── todos/                       # Todo list state
│   └── {session-uuid}-agent-{agent-uuid}.json
│
├── plans/                       # Plan mode documents
│   └── {adjective}-{verb}-{noun}.md
│
├── session-env/                 # Per-session environment state
│   └── {session-uuid}/
│
├── shell-snapshots/             # Shell environment captures
│   └── snapshot-{shell}-{timestamp}-{random}.sh
│
├── debug/                       # Debug logs
├── cache/                       # Temporary cache data
├── paste-cache/                 # Clipboard paste cache
│
├── settings.json                # User settings (permissions, hooks, model)
├── history.jsonl                # Global prompt history (all projects)
├── stats-cache.json             # Usage statistics cache
│
├── agents/                      # Custom agent definitions
├── commands/                    # Custom slash commands
├── skills/                      # Custom skills
└── plugins/                     # Plugin data

~/.claude.json                   # Global state + per-project metadata
```

---

## Path Encoding

Project paths are encoded for filesystem safety:

**Algorithm**: Replace `/` with `-`, collapse consecutive `-` into `--`

| Original Path | Encoded Directory Name |
|--------------|----------------------|
| `/Users/nico/.claude` | `-Users-nico--claude` |
| `/Users/nico/code/ai` | `-Users-nico-code-ai` |
| `/tmp/test` | `-tmp-test` |

```typescript
function encodeProjectPath(path: string): string {
  return path.replace(/\//g, '-').replace(/--+/g, '--');
}

function decodeProjectPath(encoded: string): string {
  // Reverse: split on single dash, rejoin with /
  // Handle -- as literal dash in path component
  return '/' + encoded.slice(1).replace(/--/g, '\0').replace(/-/g, '/').replace(/\0/g, '-');
}
```

---

## Session Transcript Format (JSONL)

Sessions are stored as JSON Lines files (`.jsonl`) - one JSON object per line.

### Message Entry

```typescript
interface MessageEntry {
  // Tree structure
  parentUuid: string | null;      // Previous message UUID (null for first)
  uuid: string;                   // This message's UUID (UUIDv4)

  // Session metadata
  sessionId: string;              // Session UUID
  version: string;                // Claude Code version (e.g., "2.1.12")
  cwd: string;                    // Working directory at message time
  gitBranch: string;              // Git branch name (empty if not in repo)
  timestamp: string;              // ISO 8601 timestamp

  // Message content
  type: "user" | "assistant";
  userType: "external" | "internal";  // external = human, internal = system
  message: {
    role: "user" | "assistant";
    content: string | ContentBlock[];  // String for user, blocks for assistant
    model?: string;                    // Model ID for assistant messages
    id?: string;                       // API message ID
    stop_reason?: string;
    usage?: UsageStats;
  };

  // State
  isSidechain: boolean;           // True for branched/forked conversations
  todos: TodoItem[];              // Todo list state at this point
  thinkingMetadata?: {
    level: "none" | "low" | "medium" | "high";
    disabled: boolean;
    triggers: string[];
  };
}

interface ContentBlock {
  type: "text" | "thinking" | "tool_use" | "tool_result";
  // ... type-specific fields
}
```

### Summary Entry (Context Compression)

When conversations get long, summaries are inserted to compress context:

```typescript
interface SummaryEntry {
  type: "summary";
  summary: string;                // Compressed summary text
  leafUuid: string;               // UUID of the message this summarizes up to
}
```

### File History Snapshot

Tracks file state for undo/rewind functionality:

```typescript
interface FileHistorySnapshotEntry {
  type: "file-history-snapshot";
  messageId: string;              // Associated message UUID
  isSnapshotUpdate: boolean;      // True if updating existing snapshot
  snapshot: {
    messageId: string;
    timestamp: string;
    trackedFileBackups: Record<string, string>;  // path -> backup reference
  };
}
```

### Example Session File

```jsonl
{"type":"file-history-snapshot","messageId":"abc-123","snapshot":{"messageId":"abc-123","trackedFileBackups":{},"timestamp":"2026-01-20T10:00:00.000Z"},"isSnapshotUpdate":false}
{"parentUuid":null,"uuid":"abc-123","sessionId":"session-uuid","version":"2.1.12","cwd":"/Users/nico/project","gitBranch":"main","type":"user","userType":"external","message":{"role":"user","content":"Hello"},"timestamp":"2026-01-20T10:00:00.000Z","isSidechain":false,"todos":[],"thinkingMetadata":{"level":"high","disabled":false,"triggers":[]}}
{"parentUuid":"abc-123","uuid":"def-456","sessionId":"session-uuid","version":"2.1.12","cwd":"/Users/nico/project","gitBranch":"main","type":"assistant","userType":"external","message":{"role":"assistant","content":[{"type":"text","text":"Hi there!"}],"model":"claude-opus-4-5-20251101","id":"msg_xxx","stop_reason":"end_turn"},"timestamp":"2026-01-20T10:00:05.000Z","isSidechain":false,"todos":[]}
{"type":"summary","summary":"User greeted assistant","leafUuid":"def-456"}
```

---

## Global State File (~/.claude.json)

Stores global configuration and per-project metadata:

```typescript
interface GlobalState {
  // User identity
  userID: string;
  oauthAccount?: OAuthAccount;

  // Feature flags / experiments
  cachedStatsigGates: Record<string, boolean>;
  cachedGrowthBookFeatures: Record<string, any>;
  cachedDynamicConfigs: Record<string, any>;

  // Subscription state
  hasAvailableSubscription: boolean;
  hasAvailableMaxSubscription: boolean;
  claudeMaxTier?: string;

  // Onboarding
  hasCompletedOnboarding: boolean;
  lastOnboardingVersion: string;
  firstStartTime: number;
  numStartups: number;

  // UI state
  hasSeenStashHint: boolean;
  hasSeenTasksHint: boolean;
  tipsHistory: string[];

  // Per-project metadata
  projects: Record<string, ProjectMetadata>;

  // ... other fields
}

interface ProjectMetadata {
  // Permissions
  allowedTools: string[];
  hasTrustDialogAccepted: boolean;

  // MCP servers
  mcpServers: Record<string, MCPServerConfig>;
  mcpContextUris: string[];
  enabledMcpjsonServers: string[];
  disabledMcpjsonServers: string[];

  // Onboarding
  hasCompletedProjectOnboarding: boolean;
  projectOnboardingSeenCount: number;

  // CLAUDE.md
  hasClaudeMdExternalIncludesApproved: boolean;
  hasClaudeMdExternalIncludesWarningShown: boolean;

  // Last session info (for quick resume)
  lastSessionId: string;
  lastCost: number;
  lastDuration: number;
  lastAPIDuration: number;
  lastToolDuration: number;
  lastLinesAdded: number;
  lastLinesRemoved: number;
  lastTotalInputTokens: number;
  lastTotalOutputTokens: number;
  lastTotalCacheCreationInputTokens: number;
  lastTotalCacheReadInputTokens: number;
  lastModelUsage: Record<string, ModelUsage>;

  // Security
  reactVulnerabilityCache: {
    detected: boolean;
    package: string | null;
    version: string | null;
    packageManager: string | null;
  };

  // Files shown in context
  exampleFiles: string[];
}
```

---

## File History System

Enables undo/rewind by storing file versions.

### Storage Location

`~/.claude/file-history/{session-uuid}/{file-hash}@v{version}`

### File Hash Algorithm

```typescript
function computeFileHash(absolutePath: string): string {
  // Use first 16 chars of hex-encoded hash of the path
  const hash = crypto.createHash('sha256');
  hash.update(absolutePath);
  return hash.digest('hex').slice(0, 16);
}
```

### Version Naming

- `{hash}@v1` - First backup
- `{hash}@v2` - Second backup after edit
- etc.

### Example

For file `/Users/nico/project/src/index.ts`:
```
~/.claude/file-history/abc-123-session/
├── 4d100f07092a1af2@v1    # Original content
├── 4d100f07092a1af2@v2    # After first edit
└── 4d100f07092a1af2@v3    # After second edit
```

---

## Todo State Persistence

Todo lists are stored per session and agent.

### File Naming

`~/.claude/todos/{session-uuid}-agent-{agent-uuid}.json`

For main conversation: `{session-uuid}-agent-{session-uuid}.json`

### Format

```typescript
interface TodoFile {
  todos: TodoItem[];
}

interface TodoItem {
  content: string;      // Task description (imperative: "Fix the bug")
  activeForm: string;   // Present continuous ("Fixing the bug")
  status: "pending" | "in_progress" | "completed";
}
```

---

## Prompt History

Global prompt history across all projects in `~/.claude/history.jsonl`:

```typescript
interface HistoryEntry {
  display: string;              // The prompt text
  pastedContents: Record<string, string>;  // Any pasted content
  timestamp: number;            // Unix timestamp in ms
  project: string;              // Project path
}
```

---

## Session Discovery and Resume

### Algorithm

```typescript
async function discoverSessions(cwd: string): Promise<Session[]> {
  const encodedPath = encodeProjectPath(cwd);
  const projectDir = path.join(HOME, '.claude', 'projects', encodedPath);

  // Find all .jsonl files (excluding agent-* files)
  const files = await glob('*.jsonl', { cwd: projectDir });
  const sessionFiles = files.filter(f => !f.startsWith('agent-'));

  const sessions: Session[] = [];
  for (const file of sessionFiles) {
    const sessionId = path.basename(file, '.jsonl');
    const metadata = await parseSessionMetadata(path.join(projectDir, file));
    sessions.push({
      id: sessionId,
      path: cwd,
      gitBranch: metadata.gitBranch,
      lastActivity: metadata.lastTimestamp,
      messageCount: metadata.messageCount,
      summary: metadata.lastSummary,
    });
  }

  return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
}

async function parseSessionMetadata(filepath: string): Promise<SessionMetadata> {
  const content = await fs.readFile(filepath, 'utf-8');
  const lines = content.trim().split('\n');

  let gitBranch = '';
  let lastTimestamp = 0;
  let messageCount = 0;
  let lastSummary = '';

  for (const line of lines) {
    const entry = JSON.parse(line);

    if (entry.type === 'summary') {
      lastSummary = entry.summary;
    } else if (entry.type === 'user' || entry.type === 'assistant') {
      messageCount++;
      gitBranch = entry.gitBranch || gitBranch;
      const ts = new Date(entry.timestamp).getTime();
      if (ts > lastTimestamp) lastTimestamp = ts;
    }
  }

  return { gitBranch, lastTimestamp, messageCount, lastSummary };
}
```

### Branch Filtering

Sessions store `gitBranch` on each message. To filter by current branch:

```typescript
function filterByBranch(sessions: Session[], currentBranch: string): Session[] {
  return sessions.filter(s => s.gitBranch === currentBranch);
}
```

### Worktree Grouping

Sessions from the same git repository (including worktrees) are grouped:

```typescript
async function getGitRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await exec('git rev-parse --show-toplevel', { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function groupByRepository(sessions: Session[]): Promise<Map<string, Session[]>> {
  const groups = new Map<string, Session[]>();

  for (const session of sessions) {
    const gitRoot = await getGitRoot(session.path);
    const key = gitRoot || session.path;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(session);
  }

  return groups;
}
```

---

## Session Loading

### Algorithm

```typescript
async function loadSession(sessionId: string, projectPath: string): Promise<Conversation> {
  const encodedPath = encodeProjectPath(projectPath);
  const filepath = path.join(HOME, '.claude', 'projects', encodedPath, `${sessionId}.jsonl`);

  const content = await fs.readFile(filepath, 'utf-8');
  const lines = content.trim().split('\n');

  const messages: Message[] = [];
  const summaries: Summary[] = [];
  let fileHistorySnapshot: FileHistorySnapshot | null = null;

  for (const line of lines) {
    const entry = JSON.parse(line);

    switch (entry.type) {
      case 'user':
      case 'assistant':
        messages.push(entry);
        break;
      case 'summary':
        summaries.push(entry);
        break;
      case 'file-history-snapshot':
        fileHistorySnapshot = entry.snapshot;
        break;
    }
  }

  // Reconstruct message tree using parentUuid
  const messageTree = buildMessageTree(messages);

  return {
    sessionId,
    messages: messageTree,
    summaries,
    fileHistorySnapshot,
  };
}

function buildMessageTree(messages: Message[]): Message[] {
  const byUuid = new Map(messages.map(m => [m.uuid, m]));
  const roots: Message[] = [];

  for (const msg of messages) {
    if (msg.parentUuid === null) {
      roots.push(msg);
    }
  }

  // For linear conversations, just return in order
  // For branched conversations, follow the main chain (isSidechain = false)
  return messages.filter(m => !m.isSidechain);
}
```

---

## Session Cleanup

Controlled by `cleanupPeriodDays` in `~/.claude/settings.json`:

```typescript
interface Settings {
  cleanupPeriodDays?: number;  // Default: 30
  // ... other settings
}

async function cleanupOldSessions(): Promise<void> {
  const settings = await loadSettings();
  const maxAge = (settings.cleanupPeriodDays ?? 30) * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - maxAge;

  const projectsDir = path.join(HOME, '.claude', 'projects');
  const projects = await fs.readdir(projectsDir);

  for (const project of projects) {
    const projectPath = path.join(projectsDir, project);
    const files = await glob('*.jsonl', { cwd: projectPath });

    for (const file of files) {
      const filepath = path.join(projectPath, file);
      const stat = await fs.stat(filepath);

      if (stat.mtimeMs < cutoff) {
        await fs.unlink(filepath);

        // Also clean up associated directories
        const sessionId = path.basename(file, '.jsonl');
        await fs.rm(path.join(projectPath, sessionId), { recursive: true, force: true });
        await cleanupFileHistory(sessionId);
        await cleanupTodos(sessionId);
      }
    }
  }
}
```

---

## Subagent Persistence

Subagents (Task tool) have their own transcript files.

### Naming Convention

`agent-{short-id}.jsonl` where short-id is first 7 chars of agent UUID.

### Storage

Same directory as parent session: `~/.claude/projects/{encoded-path}/`

### Working Directory

`~/.claude/projects/{encoded-path}/{session-uuid}/subagents/`

---

## Shell Snapshots

Captures shell environment for consistent bash execution.

### Location

`~/.claude/shell-snapshots/snapshot-{shell}-{timestamp}-{random}.sh`

### Content

Shell initialization script capturing:
- Environment variables
- Shell options
- Aliases (if applicable)

---

## Statistics Cache

`~/.claude/stats-cache.json` stores usage statistics:

```typescript
interface StatsCache {
  version: number;
  lastComputedDate: string;  // YYYY-MM-DD
  dailyActivity: DailyActivity[];
}

interface DailyActivity {
  date: string;           // YYYY-MM-DD
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}
```

---

## Implementation Checklist

To recreate the persistence system:

1. **Directory Setup**
   - [ ] Create `~/.claude/` directory structure on first run
   - [ ] Implement path encoding/decoding

2. **Session Management**
   - [ ] Generate UUIDs for sessions and messages
   - [ ] Write JSONL entries atomically (append mode)
   - [ ] Track parent-child relationships via parentUuid
   - [ ] Store git branch with each message

3. **File History**
   - [ ] Hash file paths for backup naming
   - [ ] Create versioned backups before edits
   - [ ] Link snapshots to messages

4. **Global State**
   - [ ] Load/save `~/.claude.json` atomically
   - [ ] Track per-project metadata
   - [ ] Store last session ID for quick resume

5. **Session Discovery**
   - [ ] Scan project directories for .jsonl files
   - [ ] Parse metadata without loading full content
   - [ ] Sort by last activity
   - [ ] Filter by git branch
   - [ ] Group by git repository

6. **Cleanup**
   - [ ] Run cleanup on startup
   - [ ] Respect cleanupPeriodDays setting
   - [ ] Clean associated directories (file-history, todos)

7. **Resume Flow**
   - [ ] `--continue`: Load last session from lastSessionId
   - [ ] `--resume`: Show session picker
   - [ ] `--resume <name>`: Match by session name/id

---

## Security Considerations

1. **File Permissions**: Session files are created with `0600` (owner read/write only)
2. **Sensitive Data**: API keys and secrets should never be stored in session transcripts
3. **Path Traversal**: Validate encoded paths to prevent directory traversal attacks
4. **Atomic Writes**: Use atomic file operations to prevent corruption
