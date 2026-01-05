import { tool } from "ai";
import { z } from "zod";
import * as path from "path";
import { isPathWithinDirectory, getSandbox, sharedContext, pathMatchesGlob } from "../../utils";

const readInputSchema = z.object({
  filePath: z
    .string()
    .describe(
      "Full absolute path to the file (e.g., /Users/username/project/file.ts)",
    ),
  offset: z
    .number()
    .optional()
    .describe("Line number to start reading from (1-indexed)"),
  limit: z
    .number()
    .optional()
    .describe("Maximum number of lines to read. Default: 2000"),
});

type ReadInput = z.infer<typeof readInputSchema>;

/**
 * Check if a file path matches any path-glob approval rules for read operations.
 */
function pathMatchesApprovalRule(filePath: string): boolean {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(sharedContext.workingDirectory, filePath);

  for (const rule of sharedContext.approvalRules) {
    if (rule.type === "path-glob" && rule.tool === "read") {
      if (pathMatchesGlob(absolutePath, rule.glob, sharedContext.workingDirectory)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if a read operation needs approval based on the file path.
 * Returns true if the path is outside the working directory and no approval rule matches.
 */
function pathNeedsApproval(args: ReadInput): boolean {
  const absolutePath = path.isAbsolute(args.filePath)
    ? args.filePath
    : path.resolve(sharedContext.workingDirectory, args.filePath);

  // Check if within working directory - no approval needed
  if (isPathWithinDirectory(absolutePath, sharedContext.workingDirectory)) {
    return false;
  }

  // Outside working directory - check if a rule matches
  // Note: Rules only apply within working directory per security considerations,
  // so this will always return true for outside-cwd paths
  if (pathMatchesApprovalRule(args.filePath)) {
    return false;
  }

  return true;
}

export const readFileTool = () => tool({
  needsApproval: pathNeedsApproval,
  description: `Read a file from the filesystem.

USAGE:
- The path should be a FULL absolute path (e.g., /Users/username/project/file.ts), not just /file.ts
- If a root-like path (e.g., /README.md) does not exist on disk, it may be resolved relative to the workspace root
- By default reads up to 2000 lines starting from line 1
- Use offset and limit for long files (both are line-based, 1-indexed)
- Results include line numbers starting at 1 in "N: content" format

IMPORTANT:
- Always read a file at least once before editing it with the edit/write tools
- This tool can only read files, not directories - attempting to read a directory returns an error
- Paths outside the working directory require approval
- You can call multiple reads in parallel to speculatively load several files

EXAMPLES:
- Read an entire file: filePath: "/Users/username/project/src/index.ts"
- Read a slice of a long file: filePath: "/Users/username/project/logs/app.log", offset: 500, limit: 200`,
  inputSchema: readInputSchema,
  execute: async ({ filePath, offset = 1, limit = 2000 }, { experimental_context }) => {
    const sandbox = getSandbox(experimental_context);
    const workingDirectory = sandbox.workingDirectory;

    try {
      // Resolve the path relative to working directory
      let absolutePath: string;
      if (path.isAbsolute(filePath)) {
        absolutePath = filePath;
      } else {
        absolutePath = path.resolve(workingDirectory, filePath);
      }

      // If the path doesn't exist and looks like a root-relative path (e.g., /README.md),
      // try resolving it relative to the working directory
      try {
        await sandbox.access(absolutePath);
      } catch {
        // Path doesn't exist - check if it's a root-relative path that should be workspace-relative
        if (
          filePath.startsWith("/") &&
          !filePath.startsWith("/Users/") &&
          !filePath.startsWith("/home/")
        ) {
          const workspaceRelativePath = path.join(workingDirectory, filePath);
          try {
            await sandbox.access(workspaceRelativePath);
            absolutePath = workspaceRelativePath;
          } catch {
            // Neither path exists - let it fall through to the original error handling
          }
        }
      }

      const stats = await sandbox.stat(absolutePath);
      if (stats.isDirectory()) {
        return {
          success: false,
          error: "Cannot read a directory. Use glob or ls command instead.",
        };
      }

      const content = await sandbox.readFile(absolutePath, "utf-8");
      const lines = content.split("\n");
      const startLine = Math.max(1, offset) - 1;
      const endLine = Math.min(lines.length, startLine + limit);
      const selectedLines = lines.slice(startLine, endLine);

      const numberedLines = selectedLines.map(
        (line, i) => `${startLine + i + 1}: ${line}`,
      );

      return {
        success: true,
        path: absolutePath,
        totalLines: lines.length,
        startLine: startLine + 1,
        endLine,
        content: numberedLines.join("\n"),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to read file: ${message}`,
      };
    }
  },
});
