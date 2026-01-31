# Open Harness

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

Releasing the CLI:

See `docs/release.md`.

Release checklist (quick):

- Pick a unique version (can be multiple per day)
- Run the **Release CLI** GitHub Action with that version
- Verify install: `curl -fsSL https://openharness.dev/install | bash`

This project was created using `bun init` in bun v1.2.23. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
