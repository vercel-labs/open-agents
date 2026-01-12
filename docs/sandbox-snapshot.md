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
  uploadUrl: string;
  downloadUrl: string;
  workingDirectory?: string;
  archivePath?: string;
  exclude?: string[];
  timeoutMs?: number;
}

export interface RestoreOptions {
  downloadUrl: string;
  workingDirectory?: string;
  timeoutMs?: number;
  clean?: boolean;
}

export interface Sandbox {
  // ...
  snapshot?(options: SnapshotOptions): Promise<{ downloadUrl: string }>;
  restoreSnapshot?(options: RestoreOptions): Promise<void>;
}
```

## VercelSandbox Implementation (packages/sandbox/vercel.ts)

Snapshot:

```bash
tar -czf /tmp/sandbox-snapshot.tgz -C /vercel/sandbox .
curl -fsSL -X PUT -T /tmp/sandbox-snapshot.tgz "$UPLOAD_URL"
```

Exclude flag construction (TypeScript sketch):

```ts
const defaultExclude = ["./node_modules", "*/node_modules", "./dist*", "./.next"];
const exclude = options.exclude ?? defaultExclude;
const excludeFlags = exclude.map((pattern) => `--exclude="${pattern}"`).join(" ");
const tarCommand = `tar -czf "${archivePath}" ${excludeFlags} -C "${cwd}" .`;
```

Restore:

```bash
curl -fsSL "$DOWNLOAD_URL" | tar -xzf - -C /vercel/sandbox
```

Notes:

- Use `exclude` to skip directories like `node_modules` if desired.
- Use `timeoutMs` to allow larger snapshots.
- Default excludes (if options.exclude is undefined) should be:
  - `./node_modules`
  - `*/node_modules`
  - `./dist*`
  - `./.next`

## LocalSandbox Implementation (packages/sandbox/local.ts)

Local sandboxes can use the same tar + curl flow to Vercel Blob, or implement
direct file IO for the tarball on disk if Blob is not needed.

## JustBashSandbox Implementation (packages/sandbox/just-bash.ts)

- Likely unsupported (no `tar`/`curl`).
- Return a structured error:
  `return { success: false, error: "Snapshot not supported by just-bash" }`

## Host-Side Blob URL Generation

The host (CLI/server) should generate a presigned Blob upload URL and stable
download URL using `@vercel/blob`, then pass those URLs into the sandbox.

## Error Handling

- If snapshot upload fails, return a clear error message with context.
- If restore fails, surface the command stderr and URL used.

## Optional Enhancements

- Add snapshot metadata (size, createdAt, excludes) as a JSON manifest.
- Support multiple snapshots by prefixing Blob keys with sandbox ID.
