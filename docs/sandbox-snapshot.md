# Sandbox Snapshots (File System Only)

This plan adds a sandbox-agnostic snapshot feature that captures the file
system state (no processes/CPU/memory). The snapshot is a tarball of the
working directory uploaded to Vercel Blob, then restored by downloading and
extracting the tarball in a new sandbox.

## Goals

- Capture all files in `workingDirectory`.
- Store snapshot in Vercel Blob for durability.
- Restore into a fresh sandbox using a stable download URL.
- Keep interface provider-agnostic, with per-provider implementation.

## Non-Goals

- No VM/process memory capture.
- No exact reproduction of running processes.
- No provider-specific hypervisor snapshots.

## Proposed Interface (packages/sandbox/interface.ts)

```ts
export interface SnapshotOptions {
  /** Vercel Blob read-write token for upload */
  blobToken: string;
  /** Blob pathname for the snapshot (e.g., "snapshots/task-123/snapshot.tgz") */
  pathname: string;
  /** Working directory to snapshot (defaults to sandbox.workingDirectory) */
  workingDirectory?: string;
  /** Local path for temporary archive (defaults to /tmp/sandbox-snapshot.tgz) */
  archivePath?: string;
  /** Glob patterns to exclude from snapshot */
  exclude?: string[];
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

export interface SnapshotResult {
  /** Public URL of the uploaded snapshot */
  url: string;
  /** Download URL with Content-Disposition: attachment */
  downloadUrl: string;
}

export interface RestoreOptions {
  /** Download URL of the snapshot to restore */
  downloadUrl: string;
  /** Working directory to restore into (defaults to sandbox.workingDirectory) */
  workingDirectory?: string;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** If true, clean the directory before restoring */
  clean?: boolean;
}

export interface Sandbox {
  // ...existing methods...
  snapshot?(options: SnapshotOptions): Promise<SnapshotResult>;
  restoreSnapshot?(options: RestoreOptions): Promise<void>;
}
```

## Vercel Blob API Details

The `@vercel/blob` SDK makes HTTP requests to `https://vercel.com/api/blob/`.
For sandbox operations (where the SDK isn't available), use curl directly:

**Upload endpoint:**
```
PUT https://vercel.com/api/blob/?pathname=<encoded-pathname>
```

**Required headers:**
```
Authorization: Bearer <BLOB_READ_WRITE_TOKEN>
x-api-version: 11
x-add-random-suffix: 0
Content-Type: application/gzip
```

**Response (JSON):**
```json
{
  "url": "https://<store>.public.blob.vercel-storage.com/<pathname>",
  "downloadUrl": "https://<store>.public.blob.vercel-storage.com/<pathname>?download=1",
  "pathname": "<pathname>",
  "contentType": "application/gzip",
  "contentDisposition": "attachment; filename=\"snapshot.tgz\""
}
```

## VercelSandbox Implementation (packages/sandbox/vercel.ts)

### Snapshot

```ts
async snapshot(options: SnapshotOptions): Promise<SnapshotResult> {
  const cwd = options.workingDirectory ?? this.workingDirectory;
  const archivePath = options.archivePath ?? "/tmp/sandbox-snapshot.tgz";
  const timeoutMs = options.timeoutMs ?? 120_000;

  // Build exclude flags
  const defaultExclude = ["./node_modules", "*/node_modules", "./dist*", "./.next"];
  const exclude = options.exclude ?? defaultExclude;
  const excludeFlags = exclude.map((p) => `--exclude="${p}"`).join(" ");

  // Create tarball
  const tarCommand = `tar -czf "${archivePath}" ${excludeFlags} -C "${cwd}" .`;
  const tarResult = await this.exec(tarCommand, cwd, timeoutMs);
  if (!tarResult.success) {
    throw new Error(`Failed to create snapshot archive: ${tarResult.stderr}`);
  }

  // Upload to Vercel Blob via curl
  const encodedPathname = encodeURIComponent(options.pathname);
  const uploadCommand = `curl -fsSL -X PUT \\
    -H "Authorization: Bearer ${options.blobToken}" \\
    -H "x-api-version: 11" \\
    -H "x-add-random-suffix: 0" \\
    -H "Content-Type: application/gzip" \\
    --data-binary "@${archivePath}" \\
    "https://vercel.com/api/blob/?pathname=${encodedPathname}"`;

  const uploadResult = await this.exec(uploadCommand, cwd, timeoutMs);
  if (!uploadResult.success) {
    throw new Error(`Failed to upload snapshot: ${uploadResult.stderr}`);
  }

  // Parse response
  const response = JSON.parse(uploadResult.stdout);
  return {
    url: response.url,
    downloadUrl: response.downloadUrl,
  };
}
```

### Restore

```ts
async restoreSnapshot(options: RestoreOptions): Promise<void> {
  const cwd = options.workingDirectory ?? this.workingDirectory;
  const timeoutMs = options.timeoutMs ?? 120_000;

  // Optionally clean directory first
  if (options.clean) {
    await this.exec(`rm -rf "${cwd}"/*`, cwd, 30_000);
  }

  // Download and extract
  const restoreCommand = `curl -fsSL "${options.downloadUrl}" | tar -xzf - -C "${cwd}"`;
  const result = await this.exec(restoreCommand, cwd, timeoutMs);
  if (!result.success) {
    throw new Error(`Failed to restore snapshot: ${result.stderr}`);
  }
}
```

## LocalSandbox Implementation (packages/sandbox/local.ts)

Local sandboxes can use the same tar + curl flow to Vercel Blob. The
implementation is nearly identical to VercelSandbox since both have full
shell access.

## JustBashSandbox Implementation (packages/sandbox/just-bash.ts)

- Not supported (simulated shell lacks `tar`/`curl`).
- Throw an error with clear message:
  ```ts
  async snapshot(): Promise<never> {
    throw new Error("Snapshot is not supported by JustBashSandbox");
  }
  async restoreSnapshot(): Promise<never> {
    throw new Error("Restore is not supported by JustBashSandbox");
  }
  ```

## Host-Side Integration

The host (web app API routes) handles:

1. **Generating snapshot pathname:** `snapshots/${taskId}/${timestamp}.tgz`
2. **Passing blob token:** From environment variable `BLOB_READ_WRITE_TOKEN`
3. **Storing snapshot metadata:** Save URL to task record in database

Example API route (`/api/sandbox/snapshot`):
```ts
// POST - Create snapshot
const result = await sandbox.snapshot({
  blobToken: process.env.BLOB_READ_WRITE_TOKEN!,
  pathname: `snapshots/${taskId}/${Date.now()}.tgz`,
});
// Save result.downloadUrl to task in database

// POST - Restore snapshot (during sandbox creation)
if (task.snapshotUrl) {
  await sandbox.restoreSnapshot({ downloadUrl: task.snapshotUrl });
}
```

## Web App UI/UX

### Sandbox Status Area (existing component)

Extend the `SandboxStatus` component to show snapshot state:

```
┌─────────────────────────────────────────────────────────┐
│  🟢 4:32 remaining  [Save Snapshot] [×]                 │
└─────────────────────────────────────────────────────────┘
```

- **Save Snapshot button:** Manual snapshot creation
- Shows spinner during snapshot upload
- Toast notification on success/failure

### Timeout Warning

When sandbox is about to expire (e.g., < 1 minute remaining):

```
┌─────────────────────────────────────────────────────────┐
│  ⚠️ Sandbox expiring in 0:45                            │
│                                                         │
│  Save your work before the sandbox times out.           │
│                                                         │
│  [Save Snapshot]  [Extend Time]  [Dismiss]              │
└─────────────────────────────────────────────────────────┘
```

### Sandbox Expired State

When sandbox expires, show restore option:

```
┌─────────────────────────────────────────────────────────┐
│  🔴 Sandbox expired                                     │
│                                                         │
│  Last snapshot: 2 minutes ago (1.2 MB)                  │
│                                                         │
│  [Restore & Continue]  [Start Fresh]                    │
└─────────────────────────────────────────────────────────┘
```

### Auto-Snapshot on Timeout

Add a setting (per-task or global) for automatic snapshots:

- When `onTimeout` hook fires, automatically create snapshot
- Store snapshot URL in task record
- Show "Auto-saved" indicator in UI

### Task Header Enhancement

Show snapshot availability in task header:

```
Task Title
Jan 12 - owner/repo - feature-branch
📦 Snapshot available (saved 5 min ago)
```

### Snapshot Creation Flow

1. User clicks "Save Snapshot"
2. Button shows loading spinner
3. Progress toast: "Creating snapshot..."
4. On success: "Snapshot saved" toast with size info
5. On failure: Error toast with retry option

### Restore Flow (on sandbox recreation)

1. User sends message after sandbox expired
2. System detects expired sandbox with available snapshot
3. Dialog appears:
   ```
   ┌─────────────────────────────────────────────────────┐
   │  Restore Previous Work?                             │
   │                                                     │
   │  A snapshot from your previous session is           │
   │  available. Would you like to restore it?           │
   │                                                     │
   │  Snapshot: Jan 12, 3:45 PM (1.2 MB)                 │
   │                                                     │
   │  [Restore Snapshot]  [Start Fresh]                  │
   └─────────────────────────────────────────────────────┘
   ```
4. On restore: Show progress, then continue with message

### Database Schema Addition

Add to tasks table:
```sql
ALTER TABLE tasks ADD COLUMN snapshot_url TEXT;
ALTER TABLE tasks ADD COLUMN snapshot_created_at TIMESTAMP;
ALTER TABLE tasks ADD COLUMN snapshot_size_bytes INTEGER;
```

## Error Handling

- If snapshot upload fails, return a clear error message with context.
- If restore fails, surface the command stderr and URL used.
- Network errors should be retried with exponential backoff.
- Partial uploads should be cleaned up.

## Optional Enhancements

- **Snapshot history:** Keep multiple snapshots per task, show list in UI.
- **Snapshot size estimation:** Show estimated size before creating snapshot.
- **Incremental snapshots:** Only upload changed files (more complex).
- **Compression options:** Allow users to choose compression level.
- **Snapshot expiration:** Auto-delete old snapshots after N days.
