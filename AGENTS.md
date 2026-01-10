# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
turbo dev              # Run CLI agent (from root)
bun run cli            # Alternative: run CLI directly
bun run web            # Run web app

# Quality checks (run after making changes)
turbo typecheck                            # Type check all packages
turbo lint                                 # Lint all packages with oxlint
turbo lint:fix                             # Lint and auto-fix all packages

# Filter by package (use --filter)
turbo typecheck --filter=web               # Type check web app only
turbo typecheck --filter=@open-harness/cli # Type check CLI only
turbo lint:fix --filter=web                # Lint web app only
turbo lint:fix --filter=@open-harness/cli  # Lint CLI only

# Formatting (Biome - run from root)
bun run format                             # Format all files
bun run format:check                       # Check formatting without writing

# Testing
bun test                        # Run all tests
bun test path/to/file.test.ts   # Run single test
```

## Architecture

This is a Turborepo monorepo for "Open Harness" - an AI coding agent built with AI SDK.

### Core Flow

```
CLI (apps/cli) → TUI (packages/tui) → Agent (packages/agent) → Sandbox (packages/sandbox)
```

1. **CLI** parses args, creates sandbox, loads AGENTS.md files, and starts the TUI
2. **TUI** renders the terminal UI with Ink/React, manages chat state via `ChatTransport`
3. **Agent** (`deepAgent`) is a `ToolLoopAgent` with tools for file ops, bash, and task delegation
4. **Sandbox** abstracts file system and shell operations (local fs or remote like Vercel)

### Key Packages

**packages/agent/** - Core agent implementation
- `deep-agent.ts` - Main agent using AI SDK's `ToolLoopAgent`, configured with tools and context management
- `tools/` - Individual tools (read, write, edit, grep, glob, bash, task, todo)
- `subagents/` - `explorer` (read-only research) and `executor` (implementation tasks)
- `context-management/` - Context compaction, cache control, model limits
- `models.ts` - Model configuration with gateway wrapper and Anthropic middleware

**packages/sandbox/** - Execution environment abstraction
- `interface.ts` - `Sandbox` interface for file system and shell operations
- `local.ts` - Local filesystem implementation
- `vercel.ts` - Vercel remote sandbox implementation

**packages/tui/** - Terminal UI
- `transport.ts` - `ChatTransport` connecting TUI to agent
- `components/` - Ink/React components for rendering

### Tool Approval System

Tools can require approval via `needsApproval` which can be:
- A boolean
- A function checking args and context (mode, autoApprove setting, approval rules)

Approval modes: `off` (all need approval), `edits` (auto-approve file changes), `all` (auto-approve everything)

### Subagent Pattern

The `task` tool delegates to specialized subagents:
- **explorer**: Read-only, for codebase research (grep, glob, read, safe bash)
- **executor**: Full access, for implementation tasks (all tools)

Both are `ToolLoopAgent` instances with their own tool sets and system prompts.

## Code Style

- Use Bun exclusively (not Node/npm/pnpm)
- Testing: `import { test, expect } from "bun:test"`
- Prefer Bun APIs: `Bun.file`, `Bun.serve`, `Bun.$` for shell
- AI SDK patterns: tools defined with Zod schemas, `ToolLoopAgent` for agents
- Kebab-case for file names
