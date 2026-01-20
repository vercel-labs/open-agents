import * as path from "path";
import type { AgentContext, ApprovalConfig, ApprovalRule } from "../types";
import type { Sandbox } from "@open-harness/sandbox";
import type { ModelMessage } from "ai";

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
  const resolvedPath = path.resolve(filePath);
  const resolvedDir = path.resolve(directory);
  return (
    resolvedPath.startsWith(resolvedDir + path.sep) ||
    resolvedPath === resolvedDir
  );
}

/**
 * Get sandbox from experimental context with null safety.
 * Throws a descriptive error if sandbox is not initialized.
 *
 * @param experimental_context - The context passed to tool execute functions
 * @param toolName - Optional tool name for better error messages
 * @returns The sandbox instance
 * @throws Error if sandbox is not available in context
 */
export function getSandbox(
  experimental_context: unknown,
  toolName?: string,
): Sandbox {
  const context = experimental_context as AgentContext | undefined;
  if (!context?.sandbox) {
    const toolInfo = toolName ? ` (tool: ${toolName})` : "";
    const contextInfo = context
      ? `Context exists but sandbox is missing. Context keys: ${Object.keys(context).join(", ")}`
      : "Context is undefined or null";
    throw new Error(
      `Sandbox not initialized in context${toolInfo}. ${contextInfo}. ` +
        "Ensure the agent's prepareCall sets experimental_context: { sandbox, ... }",
    );
  }
  return context.sandbox;
}

/**
 * Check if the approval config implies full trust (auto-approve everything within sandbox).
 * Returns true for background and delegated modes.
 *
 * @param approval - The approval configuration
 * @returns true if the context implies full trust
 */
export function shouldAutoApprove(approval: ApprovalConfig): boolean {
  return approval.type === "background" || approval.type === "delegated";
}

/**
 * Get session rules from an approval config.
 * Returns empty array for background and delegated modes.
 *
 * @param approval - The approval configuration
 * @returns Array of approval rules, or empty array if not in interactive mode
 */
export function getSessionRules(approval: ApprovalConfig): ApprovalRule[] {
  return approval.type === "interactive" ? approval.sessionRules : [];
}

/**
 * Get the full approval context from experimental_context.
 * Used by needsApproval functions to access approval configuration.
 *
 * @param experimental_context - The context passed to needsApproval functions
 * @param toolName - Optional tool name for better error messages
 * @returns Object with sandbox, workingDirectory, and approval config
 */
export function getApprovalContext(
  experimental_context: unknown,
  toolName?: string,
): {
  sandbox: Sandbox;
  workingDirectory: string;
  approval: ApprovalConfig;
} {
  const context = experimental_context as AgentContext | undefined;
  if (!context?.sandbox) {
    const toolInfo = toolName ? ` (tool: ${toolName})` : "";
    const contextInfo = context
      ? `Context exists but sandbox is missing. Context keys: ${Object.keys(context).join(", ")}`
      : "Context is undefined or null";
    throw new Error(
      `Approval context not initialized${toolInfo}. ${contextInfo}. ` +
        "Ensure the agent's prepareCall sets experimental_context: { sandbox, ... }",
    );
  }

  // Default to interactive mode with no auto-approve if approval config is missing
  const defaultApproval: ApprovalConfig = {
    type: "interactive",
    autoApprove: "off",
    sessionRules: [],
  };

  return {
    sandbox: context.sandbox,
    workingDirectory: context.sandbox.workingDirectory,
    approval: context.approval ?? defaultApproval,
  };
}

/**
 * Simple glob pattern matching for approval rules.
 * Supports patterns like "src/**", "**\/*.ts", "src/components/**".
 *
 * @param filePath - The absolute file path to check
 * @param glob - The glob pattern to match against
 * @param baseDir - The base directory for relative glob patterns
 * @param options - Optional settings
 * @param options.allowOutsideBase - If true, allow matching paths outside baseDir (for read approval rules)
 * @returns true if the file path matches the glob pattern
 */
export function pathMatchesGlob(
  filePath: string,
  glob: string,
  baseDir: string,
  options?: { allowOutsideBase?: boolean },
): boolean {
  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);

  // By default, ensure the path is within the base directory
  // This can be skipped for read approval rules which apply to paths outside the working directory
  if (!options?.allowOutsideBase) {
    if (!isPathWithinDirectory(resolvedPath, resolvedBase)) {
      return false;
    }
  }

  // Get the relative path from the base directory
  // Normalize to POSIX separators for consistent matching
  const relativePath = path
    .relative(resolvedBase, resolvedPath)
    .replace(/\\/g, "/");

  // Convert glob pattern to regex
  // First escape regex metacharacters (except * which we handle specially)
  // Then handle ** (match any directory depth), * (match any chars except /)
  try {
    const globRegex = glob
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&") // Escape regex metacharacters
      .replace(/\*\*/g, "<<<GLOBSTAR>>>") // Temporary placeholder
      .replace(/\*/g, "[^/]*") // * matches anything except /
      .replace(/<<<GLOBSTAR>>>/g, ".*") // ** matches anything including /
      .replace(/\//g, "\\/"); // Escape path separators

    const regex = new RegExp(`^${globRegex}`);
    return regex.test(relativePath);
  } catch {
    // If regex construction fails (malformed pattern), treat as no match
    return false;
  }
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

    /**
     * Additional context.
     *
     * Experimental (can break in patch releases).
     */
    experimental_context?: unknown;
  },
) => boolean | PromiseLike<boolean>;
