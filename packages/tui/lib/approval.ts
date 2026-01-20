/**
 * Approval helpers for the TUI.
 * Consolidates logic for extracting approval info and inferring approval rules.
 */
import * as path from "path";
import { getToolName } from "ai";
import type { TUIAgentUIToolPart, ApprovalRule } from "../types";

export type ToolApprovalInfo = {
  toolType: string;
  toolCommand: string;
  toolDescription?: string;
  dontAskAgainPattern?: string;
};

/**
 * Extract command prefix for approval rules.
 * Uses 3 tokens if second token is "run" (e.g., "bun run dev"), otherwise 2.
 */
function getCommandPrefix(command: string): string {
  const tokens = command.trim().split(/\s+/);
  const tokenCount = tokens[1] === "run" ? 3 : 2;
  return (
    tokens.slice(0, Math.min(tokenCount, tokens.length)).join(" ") ||
    "this command"
  );
}

/**
 * Get glob pattern for a file path's directory.
 * Used for path-glob approval rules when the input is a file path.
 */
function getDirectoryGlob(filePath: string, cwd: string): string {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(cwd, filePath);
  const relativePath = path.relative(cwd, absolutePath);
  const dirPath = path.dirname(relativePath);
  return dirPath === "." ? "**" : `${dirPath}/**`;
}

/**
 * Get glob pattern for a directory path.
 * Used for path-glob approval rules when the input is already a directory (e.g., glob/grep search paths).
 */
function getPathGlob(dirPath: string, cwd: string): string {
  const absolutePath = path.isAbsolute(dirPath)
    ? dirPath
    : path.resolve(cwd, dirPath);
  const relativePath = path.relative(cwd, absolutePath);
  return relativePath === "" || relativePath === "."
    ? "**"
    : `${relativePath}/**`;
}

/**
 * Extract approval info from a tool part for display in the approval panel.
 */
export function getToolApprovalInfo(
  part: TUIAgentUIToolPart,
  workingDirectory?: string,
): ToolApprovalInfo {
  const cwd = workingDirectory ?? process.cwd();

  switch (part.type) {
    case "tool-read": {
      const filePath = String(part.input?.filePath ?? "");
      const glob = getDirectoryGlob(filePath, cwd);
      return {
        toolType: "Read file",
        toolCommand: filePath,
        toolDescription: "Read file outside working directory",
        dontAskAgainPattern: `reads in ${glob}`,
      };
    }

    case "tool-bash": {
      const command = String(part.input?.command ?? "");
      return {
        toolType: "Bash command",
        toolCommand: command,
        dontAskAgainPattern: `${getCommandPrefix(command)} commands`,
      };
    }

    case "tool-write": {
      const filePath = String(part.input?.filePath ?? "");
      const glob = getDirectoryGlob(filePath, cwd);
      return {
        toolType: "Write file",
        toolCommand: filePath,
        toolDescription: "Create new file",
        dontAskAgainPattern: `writes in ${glob}`,
      };
    }

    case "tool-edit": {
      const filePath = String(part.input?.filePath ?? "");
      const glob = getDirectoryGlob(filePath, cwd);
      return {
        toolType: "Edit file",
        toolCommand: filePath,
        toolDescription: "Modify existing file",
        dontAskAgainPattern: `edits in ${glob}`,
      };
    }

    case "tool-task": {
      const desc = String(part.input?.task ?? "Spawning subagent");
      const subagentType = part.input?.subagentType;
      return {
        toolType:
          subagentType === "executor"
            ? "Executor task"
            : subagentType === "explorer"
              ? "Explorer task"
              : "Task",
        toolCommand: desc,
        toolDescription:
          subagentType === "executor"
            ? "This executor has full write access and can create, modify, and delete files."
            : undefined,
        dontAskAgainPattern: `${subagentType ?? "task"} operations`,
      };
    }

    case "tool-glob": {
      const pattern = String(part.input?.pattern ?? "");
      const searchPath = String(part.input?.path ?? cwd);
      const glob = getPathGlob(searchPath, cwd);
      return {
        toolType: "Glob",
        toolCommand: `"${pattern}" in ${searchPath}`,
        toolDescription: "Search files outside working directory",
        dontAskAgainPattern: `globs in ${glob}`,
      };
    }

    case "tool-grep": {
      const pattern = String(part.input?.pattern ?? "");
      const searchPath = String(part.input?.path ?? cwd);
      const glob = getPathGlob(searchPath, cwd);
      return {
        toolType: "Grep",
        toolCommand: `"${pattern}" in ${searchPath}`,
        toolDescription: "Search content outside working directory",
        dontAskAgainPattern: `greps in ${glob}`,
      };
    }

    default: {
      const toolName = getToolName(part);
      return {
        toolType: toolName.charAt(0).toUpperCase() + toolName.slice(1),
        toolCommand: JSON.stringify(part.input).slice(0, 60),
        dontAskAgainPattern: `${toolName} operations`,
      };
    }
  }
}

/**
 * Infer an ApprovalRule from a tool part.
 * Returns null if no suitable rule can be inferred.
 */
export function inferApprovalRule(
  part: TUIAgentUIToolPart,
  workingDirectory?: string,
): ApprovalRule | null {
  const cwd = workingDirectory ?? process.cwd();

  switch (part.type) {
    case "tool-read": {
      const filePath = String(part.input?.filePath ?? "");
      if (!filePath) return null;

      return {
        type: "path-glob",
        tool: "read",
        glob: getDirectoryGlob(filePath, cwd),
      };
    }

    case "tool-bash": {
      const command = String(part.input?.command ?? "").trim();
      if (!command) return null;

      return {
        type: "command-prefix",
        tool: "bash",
        prefix: getCommandPrefix(command),
      };
    }

    case "tool-write": {
      const filePath = String(part.input?.filePath ?? "");
      if (!filePath) return null;

      return {
        type: "path-glob",
        tool: "write",
        glob: getDirectoryGlob(filePath, cwd),
      };
    }

    case "tool-edit": {
      const filePath = String(part.input?.filePath ?? "");
      if (!filePath) return null;

      return {
        type: "path-glob",
        tool: "edit",
        glob: getDirectoryGlob(filePath, cwd),
      };
    }

    case "tool-task": {
      const input = part.input;
      const subagentType = input?.subagentType;
      if (subagentType !== "explorer" && subagentType !== "executor")
        return null;

      return {
        type: "subagent-type",
        tool: "task",
        subagentType,
      };
    }

    case "tool-glob": {
      const searchPath = String(part.input?.path ?? cwd);
      return {
        type: "path-glob",
        tool: "glob",
        glob: getPathGlob(searchPath, cwd),
      };
    }

    case "tool-grep": {
      const searchPath = String(part.input?.path ?? cwd);
      return {
        type: "path-glob",
        tool: "grep",
        glob: getPathGlob(searchPath, cwd),
      };
    }

    default:
      return null;
  }
}
