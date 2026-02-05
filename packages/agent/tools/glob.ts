import { tool } from "ai";
import { z } from "zod";
import * as path from "path";
import {
  getSandbox,
  getApprovalContext,
  shouldAutoApprove,
  pathNeedsApproval,
} from "./utils";

interface FileInfo {
  path: string;
  size: number;
  modifiedAt: number;
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

const globInputSchema = z.object({
  pattern: z.string().describe("Glob pattern to match (e.g., '**/*.ts')"),
  path: z
    .string()
    .optional()
    .describe("Base directory to search from (absolute path)"),
  limit: z
    .number()
    .optional()
    .describe("Maximum number of results. Default: 100"),
});

export const globTool = () =>
  tool({
    needsApproval: (args, { experimental_context }) => {
      const ctx = getApprovalContext(experimental_context, "glob");
      const { approval } = ctx;

      // Background and delegated modes auto-approve all operations
      if (shouldAutoApprove(approval)) {
        return false;
      }

      // If no path is provided, it defaults to working directory (no approval needed)
      if (!args.path) {
        return false;
      }

      return pathNeedsApproval({
        path: args.path,
        tool: "glob",
        approval,
        workingDirectory: ctx.workingDirectory,
      });
    },
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
- Results are limited by the limit parameter (default: 100)

IMPORTANT:
- Paths outside the working directory require approval
- Patterns are matched primarily on the final path segment (file name), with basic "*" and "**" support
- Use this to narrow down candidate files before calling readFileTool or grepTool

EXAMPLES:
- All TypeScript files in the project: pattern: "**/*.ts"
- All Jest tests under src: pattern: "src/**/*.test.ts"
- Recent JSON config files: pattern: "*.json", path: "/Users/username/project/config", limit: 20`,
    inputSchema: globInputSchema,
    execute: async (
      { pattern, path: basePath, limit = 100 },
      { experimental_context },
    ) => {
      const sandbox = getSandbox(experimental_context, "glob");
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

        const findArgs: string[] = [
          "find",
          shellEscape(searchDir),
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
        ];

        // Use stat to get size and mtime for each file.
        // Detect GNU stat vs BSD stat for cross-platform support.
        // Output format: mtime_epoch\tsize\tpath
        const statCmd = [
          findArgs.join(" "),
          "-exec",
          "sh -c '",
          "if stat --version >/dev/null 2>&1;",
          "then",
          // GNU stat (Linux)
          `stat -c "%Y\\t%s\\t$1" "$1";`,
          "else",
          // BSD stat (macOS)
          `stat -f "%m\\t%z\\t$1" "$1";`,
          "fi",
          "' _ {} \\;",
        ].join(" ");

        const command = statCmd + ` | sort -t'\t' -k1 -rn | head -n ${limit}`;

        const result = await sandbox.exec(
          command,
          sandbox.workingDirectory,
          30_000,
        );

        // find returns exit code 1 on permission errors but may still produce valid results
        if (!result.success && result.exitCode !== 1) {
          return {
            success: false,
            error: `Glob failed: ${result.stderr}`,
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
            path: filePath,
            size,
            modifiedAt: mtimeSeconds * 1000,
          });
        }

        return {
          success: true,
          pattern,
          baseDir: searchDir,
          count: files.length,
          files: files.map((f) => ({
            path: f.path,
            size: f.size,
            modifiedAt: new Date(f.modifiedAt).toISOString(),
          })),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: `Glob failed: ${message}`,
        };
      }
    },
  });
