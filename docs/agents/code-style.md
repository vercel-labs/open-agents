# Code Style & Patterns

Detailed coding conventions, tool implementation patterns, and common patterns for the Open Harness codebase.

## Package Manager

- Use **Bun exclusively** (not Node/npm/pnpm)
- The monorepo uses `bun@1.2.14` as the package manager

## TypeScript Configuration

- Strict mode enabled
- Target: ESNext with module "Preserve"
- `noUncheckedIndexedAccess: true` - always check indexed access
- `verbatimModuleSyntax: true` - use explicit type imports

## Formatting (Ultracite — oxfmt)

- Indent: 2 spaces
- Quote style: double quotes for JavaScript/TypeScript
- Run `bun run fix` before committing

## Naming Conventions

- **Files**: kebab-case (e.g., `deep-agent.ts`, `paste-blocks.ts`)
- **Types/Interfaces**: PascalCase (e.g., `TodoItem`, `AgentContext`)
- **Functions/Variables**: camelCase (e.g., `getSandbox`, `workingDirectory`)
- **Constants**: UPPER_SNAKE_CASE for true constants (e.g., `TIMEOUT_MS`, `SAFE_COMMAND_PREFIXES`)

## Imports

- **Do NOT use `.js` extensions** in imports (e.g., `import { foo } from "./utils"` not `"./utils.js"`)
  - The `.js` extension causes module resolution issues with Next.js/Turbopack
  - This applies to all packages and apps in the monorepo
- Prefer named exports over default exports
- Group imports: external packages first, then internal packages, then relative imports
- Use type imports when importing only types: `import type { Foo } from "./types"`

## Types

- **Never use `any`** - use `unknown` and narrow with type guards
- Define schemas with Zod, then derive types: `type Foo = z.infer<typeof fooSchema>`
- Prefer interfaces for object shapes, types for unions/intersections
- Export types alongside their related functions

## Error Handling

- Return structured error objects rather than throwing when possible:
  ```typescript
  return { success: false, error: `Failed to read file: ${message}` };
  ```
- When catching errors, extract message safely:
  ```typescript
  const message = error instanceof Error ? error.message : String(error);
  ```
- Use descriptive error messages that include context (tool name, file path, etc.)

## Testing

- Use Bun's test runner: `import { test, expect } from "bun:test"`
- Test files use `.test.ts` suffix
- Colocate tests with source files

## Bun APIs

- Prefer Bun APIs over Node when available:
  - `Bun.file()` for file operations
  - `Bun.serve()` for HTTP servers
  - `Bun.$` for shell commands in scripts

## AI SDK Patterns

- Tools are defined with Zod schemas for input validation
- Use `ToolLoopAgent` for agent implementations
- Tools receive context via `experimental_context` parameter
- Implement `needsApproval` as boolean or function for tool approval logic

## Tool Implementation Patterns

When creating tools in `packages/agent/tools/`:

```typescript
import { tool } from "ai";
import { z } from "zod";
import { getSandbox, getApprovalContext } from "./utils";

const inputSchema = z.object({
  param: z.string().describe("Description for the agent"),
});

export const myTool = (options?: { needsApproval?: boolean }) =>
  tool({
    needsApproval: (args, { experimental_context }) => {
      const ctx = getApprovalContext(experimental_context, "myTool");
      // Return true if approval needed, false otherwise
      return options?.needsApproval ?? true;
    },
    description: `Tool description with USAGE, WHEN TO USE, EXAMPLES sections`,
    inputSchema,
    execute: async (args, { experimental_context }) => {
      const sandbox = getSandbox(experimental_context, "myTool");
      // Implementation using sandbox methods
      return { success: true, result: "..." };
    },
  });
```

## Common Patterns

### Large UI files

- In already-large React view/page/client components, do **not** add new feature-specific state, effects, network calls, and JSX inline by default.
- Extract feature logic into a colocated hook (for example `use-dev-server.ts`) and extract self-contained UI regions into a colocated component (for example `dev-server-menu-items.tsx`).
- Keep the parent view responsible for shared capability flags and long-lived page state; pass the extracted feature controls down as props.
- If the feature state must survive menu/popover/dialog open-state changes, mount the hook in the parent view and pass its controls into the extracted child component instead of mounting the hook inside ephemeral UI content.

### Workspace Dependencies

Use `workspace:*` for internal packages:
```json
{
  "dependencies": {
    "@open-harness/sandbox": "workspace:*"
  }
}
```

### Catalog Dependencies

Use `catalog:` for shared external versions:
```json
{
  "dependencies": {
    "ai": "catalog:",
    "zod": "catalog:"
  }
}
```
