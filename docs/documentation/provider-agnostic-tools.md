# Provider-Agnostic Tools

This document describes how tools are implemented to work with multiple AI providers (Anthropic, OpenAI, Google, etc.) while leveraging provider-specific optimizations when available.

## Overview

The AI SDK supports three types of tools:

1. **Custom tools** - Provider-agnostic tools you define entirely yourself
2. **Provider-defined tools** - Tools where the provider specifies the schema (e.g., Anthropic's `bash_20250124`)
3. **Provider-executed tools** - Tools that run on the provider's servers

Our implementation uses a **hybrid approach**: provider-defined tools for providers that offer them (like Anthropic's bash tool), with fallback to custom tools for other providers. This gives us the best of both worlds - optimized performance for supported providers and universal compatibility.

## Architecture

### Provider Detection

The `getProvider()` function in `packages/agent/tools/utils.ts` detects the provider from a `LanguageModel`:

```typescript
export type Provider = "anthropic" | "openai" | "google" | "other";

export function getProvider(model: LanguageModel): Provider {
  // Handle string model IDs (e.g., "anthropic/claude-haiku-4.5")
  if (typeof model === "string") {
    const modelLower = model.toLowerCase();
    if (modelLower.includes("anthropic") || modelLower.includes("claude")) {
      return "anthropic";
    }
    // ... similar checks for openai, google
    return "other";
  }

  // Handle LanguageModel objects
  const providerStr = model.provider?.toLowerCase() ?? "";
  const modelId = model.modelId?.toLowerCase() ?? "";

  if (
    providerStr.includes("anthropic") ||
    modelId.includes("anthropic") ||
    modelId.includes("claude")
  ) {
    return "anthropic";
  }
  // ... similar checks for openai, google
  return "other";
}
```

This function handles both:
- String model IDs (e.g., `"anthropic:claude-haiku-4.5"`)
- `LanguageModel` objects with `provider` and `modelId` properties

### Tool Factory Pattern

Tools that have provider-specific variants use a factory function that returns the appropriate implementation based on the model.

**Example: Bash Tool** (`packages/agent/tools/bash/index.ts`):

```typescript
import { getProvider } from "../utils";
import { defaultBashTool } from "./default";
import { createAnthropicBashTool } from "./anthropic";

export function bashTool(options?: BashToolOptionsWithoutModel): DefaultBashTool;
export function bashTool(options: BashToolOptionsWithModel): DefaultBashTool | AnthropicBashTool;
export function bashTool(options?: /* combined */): DefaultBashTool | AnthropicBashTool {
  const { model, needsApproval } = options ?? {};

  if (!model) {
    return defaultBashTool({ needsApproval });
  }

  const provider = getProvider(model);
  switch (provider) {
    case "anthropic":
      return createAnthropicBashTool({ needsApproval });
    default:
      return defaultBashTool({ needsApproval });
  }
}
```

### Provider-Specific vs Default Implementations

#### Anthropic Bash Tool (`packages/agent/tools/bash/anthropic.ts`)

Uses Anthropic's provider-defined tool. The model has been specifically trained to use this tool effectively:

```typescript
import { anthropic } from "@ai-sdk/anthropic";

export const createAnthropicBashTool = (options?: { needsApproval?: boolean }) =>
  anthropic.tools.bash_20250124({
    needsApproval: (args, { experimental_context }) => {
      // Shared approval logic
      return shouldApproveCommand(args.command, ctx);
    },
    execute: async ({ command }, { experimental_context }) => {
      // Shared execution logic via executeBashCommand()
    },
  });
```

#### Default Bash Tool (`packages/agent/tools/bash/default.ts`)

Custom tool for all other providers:

```typescript
import { tool } from "ai";
import { z } from "zod";

const bashInputSchema = z.object({
  command: z.string().describe("The bash command to execute"),
  cwd: z.string().optional().describe("Working directory (absolute path)"),
});

export const defaultBashTool = (options?: { needsApproval?: boolean }) =>
  tool({
    description: "Execute bash commands...",
    inputSchema: bashInputSchema,
    needsApproval: (args, { experimental_context }) => {
      // Same shared approval logic
      return shouldApproveCommand(args.command, ctx);
    },
    execute: async (args, { experimental_context }) => {
      // Same shared execution logic via executeBashCommand()
    },
  });
```

**Key differences:**
- Anthropic tool uses provider-optimized schema (only `command` parameter)
- Default tool includes optional `cwd` parameter for explicit control
- Both share the same approval and execution logic

### Shared Logic (`packages/agent/tools/bash/shared.ts`)

Common functionality is extracted to avoid duplication:

```typescript
// Shared execution
export async function executeBashCommand(
  command: string,
  sandbox: SandboxLike,
  options?: { cwd?: string; timeout?: number }
): Promise<BashResult> {
  // Implementation used by both tools
}

// Shared approval
export function shouldApproveCommand(
  command: string,
  ctx: CommandApprovalContext
): boolean {
  if (commandMatchesApprovalRule(command, ctx.approvalRules)) {
    return false;
  }
  if (ctx.mode === "background") {
    return false;
  }
  if (ctx.mode === "interactive" && ctx.autoApprove === "all") {
    return false;
  }
  return commandNeedsApproval(command);
}
```

## Dynamic Toolset Per Request

The agent builds tools dynamically based on the model being used for each request.

**In `packages/agent/deep-agent.ts`:**

```typescript
function buildToolSet(model: LanguageModel) {
  return {
    todo_write: todoWriteTool,
    read: readFileTool(),
    write: writeFileTool({ needsApproval: true }),
    edit: editFileTool({ needsApproval: true }),
    grep: grepTool(),
    glob: globTool(),
    bash: bashTool({ model, needsApproval: true }), // Provider-specific!
    task: taskTool,
  };
}

// In prepareCall:
const callModel = options.model ?? model;
const dynamicTools = buildToolSet(callModel);
```

This enables runtime tool switching when the model changes between requests.

## Provider-Specific Optimizations

### Cache Control

Anthropic models support prompt caching. The `applyCacheControl()` function in `packages/agent/context-management/cache-control.ts` conditionally applies cache hints:

```typescript
export function applyCacheControl(
  tools: Record<string, CoreTool>,
  model: LanguageModel
): Record<string, CoreTool> {
  if (!isAnthropicModel(model)) {
    return tools; // No-op for non-Anthropic models
  }

  // Apply cacheControl: { type: "ephemeral" } to tools
}
```

## Adding Support for New Providers

To add provider-specific tool variants:

1. **Update provider detection** in `packages/agent/tools/utils.ts`:

```typescript
export function getProvider(model: LanguageModel): Provider {
  // Add detection for new provider
  if (modelLower.includes("newprovider") || modelLower.includes("newmodel")) {
    return "newprovider";
  }
}
```

2. **Create provider-specific implementation** (if provider offers optimized tools):

```typescript
// packages/agent/tools/bash/newprovider.ts
import { newprovider } from "@ai-sdk/newprovider";

export const createNewProviderBashTool = (options) =>
  newprovider.tools.bash({
    needsApproval: (args, ctx) => shouldApproveCommand(args.command, getCtx(ctx)),
    execute: (args, ctx) => executeBashCommand(args.command, getSandbox(ctx)),
  });
```

3. **Update the factory function**:

```typescript
// packages/agent/tools/bash/index.ts
export function bashTool(options) {
  const provider = getProvider(model);
  switch (provider) {
    case "anthropic":
      return createAnthropicBashTool({ needsApproval });
    case "newprovider":
      return createNewProviderBashTool({ needsApproval });
    default:
      return defaultBashTool({ needsApproval });
  }
}
```

## Tools Without Provider-Specific Variants

Most tools (read, write, edit, grep, glob, task, todo) are provider-agnostic and use the standard `tool()` function from AI SDK. They work identically across all providers:

```typescript
export const readFileTool = () =>
  tool({
    description: "Read a file from the filesystem",
    inputSchema: z.object({
      path: z.string().describe("Absolute path to the file"),
    }),
    execute: async (args, { experimental_context }) => {
      const sandbox = getSandbox(experimental_context, "read");
      return sandbox.readFile(args.path);
    },
  });
```

Provider-specific variants are only needed when a provider offers optimized tools that the model has been trained to use.

## Summary

| Aspect | Implementation |
|--------|----------------|
| Provider detection | `getProvider()` function handles strings and objects |
| Tool selection | Factory pattern returns appropriate implementation |
| Shared logic | Common execution/approval in `shared.ts` |
| Dynamic toolsets | Built per-request based on model |
| Cache control | Applied conditionally for Anthropic only |
| Fallback | Default custom tool for unknown providers |
