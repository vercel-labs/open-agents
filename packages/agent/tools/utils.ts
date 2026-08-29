import type { InferToolSetContext } from "@ai-sdk/provider-utils";
import { connectSandbox, type Sandbox } from "@open-agents/sandbox";
import type { LanguageModel, ModelMessage, ToolSet } from "ai";
import * as path from "path";
import type { AgentContext } from "../types";

/**
 * Placeholder context for agent construction. The AI SDK requires contextual
 * tools to have an initial context map; every actual call replaces this
 * placeholder in prepareCall before any tool executes, so the empty object is
 * never observed by a running tool.
 */
export const PLACEHOLDER_AGENT_CONTEXT = {} as AgentContext;

/**
 * Build a toolsContext map that binds every tool in the set to the same
 * shared context object.
 *
 * Invariant asserted by the single cast below: every context-consuming tool
 * in this codebase declares `contextSchema: agentContextSchema`, so one
 * AgentContext value is valid for the entire tool set. Tools without a
 * contextSchema simply ignore their entry.
 */
export function uniformToolsContext<TOOLS extends ToolSet>(
  tools: TOOLS,
  context: AgentContext,
): InferToolSetContext<TOOLS> {
  return Object.fromEntries(
    Object.keys(tools).map((name) => [name, context]),
  ) as InferToolSetContext<TOOLS>;
}

/**
 * Check if a file path is within a given directory.
 * Used as a security boundary to prevent path traversal attacks.
 *
 * @param filePath - The path to check
 * @param directory - The directory that should contain the path
 * @returns true if filePath is within or equal to directory
 */
export function isPathWithinDirectory(
  filePath: string,
  directory: string,
): boolean {
  const resolvedDir = path.resolve(directory);
  const resolvedPath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(resolvedDir, filePath);
  return (
    resolvedPath.startsWith(resolvedDir + path.sep) ||
    resolvedPath === resolvedDir
  );
}

/**
 * Convert a path into a compact, model-friendly display path.
 *
 * Paths inside the sandbox working directory are returned relative to that
 * directory (e.g., "src/index.ts") to avoid repeating long absolute prefixes.
 * Paths outside the working directory remain absolute for clarity and safety.
 */
export function toDisplayPath(
  filePath: string,
  workingDirectory: string,
): string {
  const absolutePath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(workingDirectory, filePath);

  if (!isPathWithinDirectory(absolutePath, workingDirectory)) {
    return absolutePath.replace(/\\/g, "/");
  }

  const relativePath = path.relative(workingDirectory, absolutePath);
  if (relativePath === "") {
    return ".";
  }

  return relativePath.replace(/\\/g, "/");
}

/**
 * Get sandbox from tool context with null safety.
 * Throws a descriptive error if sandbox is not initialized.
 *
 * @param toolContext - The context passed to tool execute functions
 * @param toolName - Optional tool name for better error messages
 * @returns The sandbox instance
 * @throws Error if sandbox is not available in context
 */
export async function getSandbox(
  context: AgentContext,
  toolName?: string,
): Promise<Sandbox> {
  // Defensive: PLACEHOLDER_AGENT_CONTEXT is an empty object behind a cast, so
  // a misconfigured agent (prepareCall not replacing it) surfaces here.
  if (!context.sandbox) {
    const toolInfo = toolName ? ` (tool: ${toolName})` : "";
    throw new Error(
      `Sandbox not initialized in context${toolInfo}. ` +
        `Context keys: ${Object.keys(context).join(", ") || "none"}. ` +
        "Ensure the agent's prepareCall sets toolsContext for this tool.",
    );
  }

  return connectSandbox(context.sandbox.state);
}

/**
 * Get sandbox + working directory from tool context for approval checks.
 *
 * @param toolContext - The context passed to needsApproval functions
 * @param toolName - Optional tool name for better error messages
 */
export function getSandboxContext(
  context: AgentContext,
  toolName?: string,
): {
  sandbox: AgentContext["sandbox"];
  workingDirectory: string;
} {
  // Defensive: see getSandbox for why the placeholder can be an empty object.
  if (!context.sandbox) {
    const toolInfo = toolName ? ` (tool: ${toolName})` : "";
    throw new Error(
      `Sandbox context not initialized${toolInfo}. ` +
        `Context keys: ${Object.keys(context).join(", ") || "none"}. ` +
        "Ensure the agent's prepareCall sets toolsContext for this tool.",
    );
  }

  return {
    sandbox: context.sandbox,
    workingDirectory: context.sandbox.workingDirectory,
  };
}

/**
 * Get model from tool context with null safety.
 * Throws a descriptive error if model is not initialized.
 */
export function getModel(
  context: AgentContext,
  toolName?: string,
): LanguageModel {
  // Defensive: see getSandbox for why the placeholder can be an empty object.
  if (!context.model) {
    const toolInfo = toolName ? ` (tool: ${toolName})` : "";
    throw new Error(
      `Model not initialized in context${toolInfo}. ` +
        `Context keys: ${Object.keys(context).join(", ") || "none"}. ` +
        "Ensure the agent's prepareCall sets toolsContext for this tool.",
    );
  }
  return context.model;
}

/**
 * Get subagent model from tool context, falling back to the main model.
 * Returns the dedicated subagent model if configured, otherwise the main agent model.
 */
export function getSubagentModel(
  context: AgentContext,
  toolName?: string,
): LanguageModel {
  // Defensive: see getSandbox for why the placeholder can be an empty object.
  if (!context.model) {
    const toolInfo = toolName ? ` (tool: ${toolName})` : "";
    throw new Error(
      `Model not initialized in context${toolInfo}. ` +
        "Ensure the agent's prepareCall sets toolsContext for this tool.",
    );
  }
  return context.subagentModel ?? context.model;
}

/**
 * Escape a string for safe use in a single-quoted shell argument.
 * Wraps the string in single quotes and escapes any embedded single quotes.
 */
export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export type ToolNeedsApprovalFunction<INPUT> = (
  input: INPUT,
  options: {
    /**
     * The ID of the tool call. You can use it e.g. when sending tool-call related information with stream data.
     */
    toolCallId: string;

    /**
     * Messages that were sent to the language model to initiate the response that contained the tool call.
     * The messages **do not** include the system prompt nor the assistant response that contained the tool call.
     */
    messages: ModelMessage[];

    context: AgentContext;
  },
) => boolean | PromiseLike<boolean>;
