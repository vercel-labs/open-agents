import { tool } from "ai";
import { z } from "zod";
import * as path from "path";
import { getSandbox, shellEscape, toDisplayPath } from "./utils";

interface FileInfo {
  path: string;
  size: number;
  modifiedAt: number;
}

const globInputSchema = z.object({
  pattern: z.string().describe("Glob pattern to match (e.g., '**/*.ts')"),
  path: z
    .string()
    .optional()
    .describe("Workspace-relative base directory to search from (e.g., src)"),
  limit: z
    .number()
    .optional()
    .describe("Maximum number of results. Default: 100"),
});

export const globTool = () =>
  tool({
    description: `Find files matching a glob pattern.

WHEN TO USE:
- Locating files by extension or naming pattern (e.g., all *.test.ts files)
- Discovering where components, migrations, or configs live
- Getting a quick list of recently modified files of a given type

WHEN NOT TO USE:
- Searching inside file contents (use grepTool instead)
- Reading file contents (use readFileTool instead)
- Arbitrary directory listings (bashTool with ls may be more appropriate)

USAGE:
- Supports patterns like "**/*.ts", "src/**/*.js", "*.json"
- Returns FILES (not directories) sorted by modification time (newest first)
- Skips hidden files (names starting with ".") and node_modules
- If path is omitted, the current working directory is used as the base
- Use workspace-relative paths when setting path
- Results are limited by the limit parameter (default: 100)

IMPORTANT:
- Patterns are matched primarily on the final path segment (file name), with basic "*" and "**" support
- Use this to narrow down candidate files before calling readFileTool or grepTool

EXAMPLES:
- All TypeScript files in the project: pattern: "**/*.ts"
- All Jest tests under src: pattern: "src/**/*.test.ts"
- Recent JSON config files: pattern: "*.json", path: "config", limit: 20`,
    inputSchema: globInputSchema,
    execute: async (
      { pattern, path: basePath, limit = 100 },
      { experimental_context },
    ) => {
      const sandbox = await getSandbox(experimental_context, "glob");
      const workingDirectory = sandbox.workingDirectory;

      try {
        let searchDir: string;
        if (basePath) {
          searchDir = path.isAbsolute(basePath)
            ? basePath
            : path.resolve(workingDirectory, basePath);
        } else {
          searchDir = workingDirectory;
        }

        // Extract file name pattern from glob (last segment)
        const patternParts = pattern.split("/").filter(Boolean);
        const namePattern = patternParts[patternParts.length - 1] ?? "*";

        // Extract literal directory prefix (segments before any wildcards)
        // e.g., "src/components/**/*.tsx" → prefix "src/components", name "*.tsx"
        const literalPrefix: string[] = [];
        for (let i = 0; i < patternParts.length - 1; i++) {
          const part = patternParts[i]!;
          if (part.includes("*") || part.includes("?") || part.includes("[")) {
            break;
          }
          literalPrefix.push(part);
        }
        if (literalPrefix.length > 0) {
          searchDir = path.join(searchDir, ...literalPrefix);
        }

        // Determine maxdepth from remaining wildcard directory segments.
        // e.g., "src/*/utils.ts" → literalPrefix ["src"], remaining dir ["*"], name "utils.ts"
        //   → maxdepth 2 (one dir level + the file)
        // e.g., "src/**/*.tsx" → remaining dir ["**"] → no maxdepth (recursive)
        // e.g., "*.json" → no remaining dir segments → maxdepth 1 (current dir only)
        const remainingDirSegments = patternParts.slice(
          literalPrefix.length,
          patternParts.length - 1,
        );
        // A trailing "**" segment (e.g. "**", "src/**") should also remain recursive.
        const hasRecursiveWildcard =
          remainingDirSegments.some((s) => s === "**") || namePattern === "**";

        let maxDepth: number | undefined;
        if (!hasRecursiveWildcard) {
          // Each * segment = one directory level, +1 for the file itself
          maxDepth = remainingDirSegments.length + 1;
        }

        const findArgs: string[] = ["find", shellEscape(searchDir)];
        if (maxDepth !== undefined) {
          findArgs.push("-maxdepth", String(maxDepth));
        }
        findArgs.push(
          "-not",
          "-path",
          "'*/.*'",
          "-not",
          "-path",
          "'*/node_modules/*'",
          "-type",
          "f",
          "-name",
          shellEscape(namePattern),
        );

        // Get file metadata (mtime, size) along with paths.
        // GNU find -printf (Linux): outputs mtime/size/path directly.
        // BSD find (macOS): pipe to xargs stat to avoid running find twice.
        const findBase = findArgs.join(" ");
        const command = [
          `{ ${findBase} -printf '%T@\\t%s\\t%p\\n' 2>/dev/null`,
          `|| ${findBase} -print0 | xargs -0 stat -f '%m%t%z%t%N' ; }`,
          `| sort -t$'\\t' -k1 -rn | head -n ${limit}`,
        ].join(" ");

        const result = await sandbox.exec(
          command,
          sandbox.workingDirectory,
          30_000,
        );

        // find returns exit code 1 on permission errors but may still produce valid results
        if (!result.success && result.exitCode !== 1) {
          return {
            success: false,
            error: `Glob failed (exit ${result.exitCode}): ${result.stdout.slice(0, 500)}`,
          };
        }

        const files: FileInfo[] = [];
        const lines = result.stdout.split("\n").filter(Boolean);

        for (const line of lines) {
          // Format: mtime_epoch\tsize\tpath
          const firstTab = line.indexOf("\t");
          if (firstTab === -1) continue;
          const secondTab = line.indexOf("\t", firstTab + 1);
          if (secondTab === -1) continue;

          const mtimeSeconds = parseFloat(line.slice(0, firstTab));
          const size = parseInt(line.slice(firstTab + 1, secondTab), 10);
          const filePath = line.slice(secondTab + 1);

          if (isNaN(mtimeSeconds) || isNaN(size) || !filePath) continue;

          files.push({
            path: toDisplayPath(filePath, workingDirectory),
            size,
            modifiedAt: mtimeSeconds * 1000,
          });
        }

        const response: Record<string, unknown> = {
          success: true,
          pattern,
          baseDir: toDisplayPath(searchDir, workingDirectory),
          count: files.length,
          files: files.map((f) => ({
            path: f.path,
            size: f.size,
            modifiedAt: new Date(f.modifiedAt).toISOString(),
          })),
        };

        // Include debug info when no results found to aid diagnosis
        if (files.length === 0) {
          response._debug = {
            command,
            exitCode: result.exitCode,
            stdoutPreview: result.stdout.slice(0, 500),
          };
        }

        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: `Glob failed: ${message}`,
        };
      }
    },
  });
