# Deep Agent - AI SDK Coding Agent

## Commands
- `bun run dev` - Run CLI agent
- `bun run typecheck` - Type check
- `bun run lint` - Lint with oxlint
- `bun run lint:fix` - Lint and auto-fix issues
- `bun run format` - Format with Biome
- `bun run format:check` - Check formatting
- `bun test` - Run all tests
- `bun test path/to/file.test.ts` - Run single test

## After Making Changes
Always run these commands after modifying code:
1. `bun run format` - Format code
2. `bun run lint:fix` - Fix linting issues
3. `bun run typecheck` - Verify types

## Architecture
- `src/agent/` - Core agent: deep-agent.ts (main), system-prompt.ts, types.ts
- `src/agent/tools/` - Tools: file-system, memory, planning, task-delegation
- `src/agent/sandbox/` - Sandbox execution, `src/agent/state/` - State management
- `src/cli/` - CLI entry point, `src/tui/` - Terminal UI with Ink/React
- `src/models.ts` - Model configuration using AI SDK

## Code Style
- Use Bun exclusively (not Node, npm, pnpm, vite, express, ws, dotenv)
- Testing: `import { test, expect } from "bun:test"`
- Prefer Bun APIs: `Bun.file`, `Bun.serve`, `bun:sqlite`, `Bun.$` for shell
- Use AI SDK patterns: tool definitions with Zod schemas
- TypeScript strict mode, Zod for runtime validation
- Dependencies: ai, @ai-sdk/anthropic, ink, zod
