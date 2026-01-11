import * as path from "path";
import type {
  AgentContext,
  AgentMode,
  AutoApprove,
  ApprovalRule,
} from "../types";
import type { Sandbox } from "@open-harness/sandbox";

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
 * Get agent mode from experimental context.
 * Defaults to 'interactive' if not set (backward compatibility).
 *
 * @param experimental_context - The context passed to tool execute functions
 * @returns The agent mode ('interactive' or 'background')
 */
export function getMode(experimental_context: unknown): AgentMode {
  const context = experimental_context as AgentContext | undefined;
  return context?.mode ?? "interactive";
}

/**
 * Check if the agent is running in background mode.
 * Useful for conditional logic in tools.
 *
 * @param experimental_context - The context passed to tool execute functions
 * @returns true if running in background mode
 */
export function isBackgroundMode(experimental_context: unknown): boolean {
  return getMode(experimental_context) === "background";
}

/**
 * Get the full approval context from experimental_context.
 * Used by needsApproval functions to access mode, autoApprove, and approvalRules.
 *
 * @param experimental_context - The context passed to needsApproval functions
 * @param toolName - Optional tool name for better error messages
 * @returns Object with sandbox, mode, autoApprove, and approvalRules
 */
export function getApprovalContext(
  experimental_context: unknown,
  toolName?: string,
): {
  sandbox: Sandbox;
  workingDirectory: string;
  mode: AgentMode;
  autoApprove: AutoApprove;
  approvalRules: ApprovalRule[];
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
  return {
    sandbox: context.sandbox,
    workingDirectory: context.sandbox.workingDirectory,
    mode: context.mode ?? "interactive",
    autoApprove: context.autoApprove ?? "off",
    approvalRules: context.approvalRules ?? [],
  };
}

/**
 * Simple glob pattern matching for approval rules.
 * Supports patterns like "src/**", "**\/*.ts", "src/components/**".
 *
 * @param filePath - The absolute file path to check
 * @param glob - The glob pattern to match against
 * @param baseDir - The base directory for relative glob patterns
 * @returns true if the file path matches the glob pattern
 */
export function pathMatchesGlob(
  filePath: string,
  glob: string,
  baseDir: string,
): boolean {
  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);

  // Ensure the path is within the base directory
  if (!isPathWithinDirectory(resolvedPath, resolvedBase)) {
    return false;
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
