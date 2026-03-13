import { tool } from "ai";
import { z } from "zod";
import * as path from "path";
import * as fs from "fs";
import { getSandbox, toDisplayPath } from "./utils";

const readInputSchema = z.object({
  filePath: z
    .string()
    .describe(
      "Workspace-relative path to the file to read (e.g., src/index.ts)",
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

/**
 * Resolve file path with fallback for root-like paths.
 * If a path like "/README.md" doesn't exist, try resolving it relative to workingDirectory.
 */
function resolveFilePath(filePath: string, workingDirectory: string): string {
  let absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(workingDirectory, filePath);

  // If path doesn't exist and looks like a root-relative path (e.g., /README.md),
  // try resolving it relative to the working directory
  try {
    fs.accessSync(absolutePath);
  } catch {
    if (
      filePath.startsWith("/") &&
      !filePath.startsWith("/Users/") &&
      !filePath.startsWith("/home/")
    ) {
      const workspaceRelativePath = path.join(workingDirectory, filePath);
      try {
        fs.accessSync(workspaceRelativePath);
        absolutePath = workspaceRelativePath;
      } catch {
        // Neither path exists - return original
      }
    }
  }

  return absolutePath;
}

export const readFileTool = () =>
  tool({
    description: `Read a file from the filesystem.

USAGE:
- Use workspace-relative paths (e.g., "src/index.ts")
- Paths are resolved from the workspace root
- By default reads up to 2000 lines starting from line 1
- Use offset and limit for long files (both are line-based, 1-indexed)
- Results include line numbers starting at 1 in "N: content" format

IMPORTANT:
- Always read a file at least once before editing it with the edit/write tools
- This tool can only read files, not directories - attempting to read a directory returns an error
- You can call multiple reads in parallel to speculatively load several files

EXAMPLES:
- Read an entire file: filePath: "src/index.ts"
- Read a slice of a long file: filePath: "logs/app.log", offset: 500, limit: 200`,
    inputSchema: readInputSchema,
    execute: async (
      { filePath, offset = 1, limit = 2000 },
      { experimental_context },
    ) => {
      const sandbox = await getSandbox(experimental_context, "read");
      const workingDirectory = sandbox.workingDirectory;

      try {
        // Use the same path resolution logic as needsApproval
        const absolutePath = resolveFilePath(filePath, workingDirectory);

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
          path: toDisplayPath(absolutePath, workingDirectory),
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
