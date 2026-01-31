# CLI Releases (Simple)

This is the easy, repeatable way to ship the CLI and keep the one-command install working.

## One-command install (what users run)

```bash
curl -fsSL https://openharness.dev/install | bash
```

The installer script downloads a prebuilt binary from the Blob URL in `installer.config.json` and uses the `latest` pointer to pick a version.

## The release flow (CI does all distros)

1) Pick a unique version string. You can release multiple times per day as long as the version changes.

Examples:
- `0.2.0-20260131.1`
- `2026.01.31.1`

2) Run the GitHub Actions workflow **Release CLI** (manual trigger).
- Input: `version`
- This builds on macOS (arm64 + x64), Linux (arm64 + x64), and Windows (x64)
- It uploads artifacts to Blob and optionally updates `latest`

That's it - the curl install command will now install the new version.

## Local testing (no CI)

This builds your host target only, then installs from the local binary without editing your PATH:

```bash
bun run release:local
```

This command wipes `~/.openharness/bin` first so you always test a clean install.

Run the CLI:

```bash
~/.openharness/bin/openharness --help
```

## Optional: end-to-end curl test before CI

If you want to test the real curl install flow before running CI:

1) Upload a local build to a temporary Blob prefix:

```bash
BLOB_READ_WRITE_TOKEN=... bun run upload:release --version 0.0.0-local --dir dist --targets <your-host-target> --prefix <your-name>/local
```

2) Run the installer with the Blob override (no deploy needed):

```bash
curl -fsSL https://openharness.dev/install | OPEN_HARNESS_BLOB_BASE_URL="https://<your-blob-domain>/<your-name>/local" bash
```

Note: the Blob override env var only affects the install source, not the public website.

## Troubleshooting

If you see:

```
TreeSitter worker error: BuildMessage: ModuleNotFound resolving "/$bunfs/root/parser.worker.ts"
```

Run a new build using `bun run build:release-artifacts` (or `bun run release:local`). The release artifacts must include `parser.worker.js` alongside the CLI binary.

If you see:

```
TreeSitter worker error: error: Cannot find package 'web-tree-sitter'
```

Rebuild and reinstall. The release artifacts must include `node_modules/web-tree-sitter` next to the CLI binary.
