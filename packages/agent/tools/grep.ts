import { tool } from "ai";
import { z } from "zod";
import * as path from "path";
import {
  getSandbox,
  getApprovalContext,
  shouldAutoApprove,
  pathNeedsApproval,
} from "./utils";

interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

const grepInputSchema = z.object({
  pattern: z.string().describe("Regex pattern to search for"),
  path: z.string().describe("File or directory to search in (absolute path)"),
  glob: z
    .string()
    .optional()
    .describe("Glob pattern to filter files (e.g., '*.ts')"),
  caseSensitive: z
    .boolean()
    .optional()
    .describe("Case-sensitive search. Default: true"),
});

export const grepTool = () =>
  tool({
    needsApproval: (args, { experimental_context }) => {
      const ctx = getApprovalContext(experimental_context, "grep");
      const { approval } = ctx;

      // Background and delegated modes auto-approve all operations
      if (shouldAutoApprove(approval)) {
        return false;
      }

      return pathNeedsApproval({
        path: args.path,
        tool: "grep",
        approval,
        workingDirectory: ctx.workingDirectory,
      });
    },
    description: `Search for patterns in files using JavaScript regular expressions.

WHEN TO USE:
- Finding where a function, variable, or string literal is used
- Locating configuration keys, routes, or error messages across files
- Narrowing down which files to read or edit

WHEN NOT TO USE:
- Simple filename-only searches (use globTool instead)
- Complex, multi-round codebase exploration (use taskTool with detailed instructions)
- Directory listings, builds, or other shell tasks (use bashTool instead)

USAGE:
- Uses JavaScript RegExp syntax (e.g., "log.*Error", "function\\s+\\w+")
- Search a specific file OR an entire directory via the path parameter
- Optionally filter files with glob (e.g., "*.ts", "*.test.js")
- Matches are SINGLE-LINE: patterns do not span across newline characters
- Results are limited to 100 matches total, with up to 10 matches per file; each match line is truncated to 200 characters

IMPORTANT:
- ALWAYS use this tool for code/content searches instead of running grep/rg via bashTool
- Use caseSensitive: false for case-insensitive searches
- Hidden files and node_modules are skipped when searching directories
- Paths outside the working directory require approval

EXAMPLES:
- Find all TODO comments in TypeScript files: pattern: "TODO", path: "/Users/username/project", glob: "*.ts"
- Find all references to a function (case-insensitive): pattern: "handleRequest", path: "/Users/username/project/src", caseSensitive: false`,
    inputSchema: grepInputSchema,
    execute: async (
      { pattern, path: searchPath, glob, caseSensitive = true },
      { experimental_context },
    ) => {
      const sandbox = getSandbox(experimental_context, "grep");
      const workingDirectory = sandbox.workingDirectory;

      try {
        const absolutePath = path.isAbsolute(searchPath)
          ? searchPath
          : path.resolve(workingDirectory, searchPath);

        const maxTotal = 100;
        const maxPerFile = 10;

        const args: string[] = ["grep", "-rn"];
        if (!caseSensitive) args.push("-i");

        args.push("--exclude-dir=.*", "--exclude-dir=node_modules");
        args.push("--null");

        if (glob) {
          args.push(`--include=${shellEscape(glob)}`);
        }

        args.push("-E", shellEscape(pattern), shellEscape(absolutePath));

        const command = args.join(" ") + ` | head -n ${maxTotal}`;

        const result = await sandbox.exec(
          command,
          sandbox.workingDirectory,
          30_000,
        );

        // grep exits with 1 when no matches found - that's not an error
        if (!result.success && result.exitCode !== 1) {
          return {
            success: false,
            error: `Grep failed: ${result.stderr}`,
          };
        }

        const matches: GrepMatch[] = [];
        const filesSet = new Set<string>();
        const fileMatchCounts = new Map<string, number>();

        const lines = result.stdout.split("\n").filter(Boolean);
        for (const line of lines) {
          if (matches.length >= maxTotal) break;

          // With --null, format is: file\0line:content
          // Fall back to colon-based parsing if NUL not present
          const nulIndex = line.indexOf("\0");
          let file: string;
          let rest: string;
          if (nulIndex !== -1) {
            file = line.slice(0, nulIndex);
            rest = line.slice(nulIndex + 1);
          } else {
            const firstColon = line.indexOf(":");
            if (firstColon === -1) continue;
            file = line.slice(0, firstColon);
            rest = line.slice(firstColon + 1);
          }
          const colonIndex = rest.indexOf(":");
          if (colonIndex === -1) continue;

          const lineNum = parseInt(rest.slice(0, colonIndex), 10);
          const content = rest.slice(colonIndex + 1);

          if (isNaN(lineNum)) continue;

          filesSet.add(file);
          const currentFileCount = fileMatchCounts.get(file) ?? 0;
          if (currentFileCount >= maxPerFile) continue;

          fileMatchCounts.set(file, currentFileCount + 1);
          matches.push({
            file,
            line: lineNum,
            content: content.slice(0, 200),
          });
        }

        return {
          success: true,
          pattern,
          matchCount: matches.length,
          filesWithMatches: filesSet.size,
          matches,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: `Grep failed: ${message}`,
        };
      }
    },
  });
