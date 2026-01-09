# Deep Agent - AI SDK Coding Agent

## Commands
- `turbo dev` - Run CLI agent (from root)
- `turbo typecheck` - Type check all packages
- `turbo lint` - Lint all packages with oxlint
- `turbo lint:fix` - Lint and auto-fix issues
- `bun run format` - Format with Biome
- `bun run format:check` - Check formatting
- `bun test` - Run all tests
- `bun test path/to/file.test.ts` - Run single test

## After Making Changes
Always run these commands after modifying code:
1. `bun run format` - Format code
2. `turbo lint:fix` - Fix linting issues
3. `turbo typecheck` - Verify types

## Monorepo Architecture
This is a Turborepo monorepo with the following structure:

### Apps
- `apps/cli/` - CLI entry point application

### Packages
- `packages/agent/` - Core agent: deep-agent.ts (main), system-prompt.ts, types.ts
  - `tools/` - Tools: file-system, memory, planning, task-delegation
  - `sandbox/` - Sandbox execution (local, vercel, just-bash)
  - `context-management/` - Context and token management
  - `subagents/` - Sub-agent implementations
  - `models.ts` - Model configuration using AI SDK
- `packages/tui/` - Terminal UI with Ink/React
  - `components/` - UI components
  - `lib/` - Utility functions
- `packages/tsconfig/` - Shared TypeScript configurations

## Code Style
- Use Bun exclusively (not Node, npm, pnpm, vite, express, ws, dotenv)
- Testing: `import { test, expect } from "bun:test"`
- Prefer Bun APIs: `Bun.file`, `Bun.serve`, `bun:sqlite`, `Bun.$` for shell
- Use AI SDK patterns: tool definitions with Zod schemas
- TypeScript strict mode, Zod for runtime validation
- Dependencies: ai, @ai-sdk/anthropic, ink, zod
