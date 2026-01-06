import { tool } from "ai";
import { z } from "zod";
import * as path from "path";
import type { Sandbox } from "../../sandbox";
import {
  isPathWithinDirectory,
  getSandbox,
  pathMatchesGlob,
  getApprovalContext,
} from "../../utils";
import type { ApprovalRule } from "../../types";

interface FileInfo {
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: number;
}

async function findFiles(
  baseDir: string,
  pattern: string,
  limit: number,
  sandbox: Sandbox,
): Promise<FileInfo[]> {
  const results: FileInfo[] = [];

  const patternParts = pattern.split("/").filter(Boolean);
  const hasRecursive = pattern.includes("**");

  async function matchesPattern(
    filePath: string,
    fileName: string,
  ): Promise<boolean> {
    const lastPart = patternParts[patternParts.length - 1] ?? "*";

    if (lastPart === "*") return true;

    if (lastPart.startsWith("*.")) {
      const ext = lastPart.slice(1);
      return fileName.endsWith(ext);
    }

    if (lastPart.includes("*")) {
      const regex = new RegExp(
        "^" + lastPart.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
      );
      return regex.test(fileName);
    }

    return fileName === lastPart;
  }

  async function walk(currentDir: string, depth: number = 0) {
    if (results.length >= limit) return;

    try {
      const entries = await sandbox.readdir(currentDir, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        if (results.length >= limit) break;

        if (entry.name.startsWith(".") || entry.name === "node_modules") {
          continue;
        }

        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (hasRecursive || depth < patternParts.length - 1) {
            await walk(fullPath, depth + 1);
          }
        } else {
          const matches = await matchesPattern(fullPath, entry.name);
          if (matches) {
            try {
              const stats = await sandbox.stat(fullPath);
              results.push({
                path: fullPath,
                isDirectory: false,
                size: stats.size,
                modifiedAt: stats.mtimeMs,
              });
            } catch {
              // Skip files we can't stat
            }
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  await walk(baseDir);

  results.sort((a, b) => b.modifiedAt - a.modifiedAt);

  return results;
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

/**
 * Check if a path matches any path-glob approval rules for glob operations.
 */
function pathMatchesApprovalRule(
  searchPath: string,
  workingDirectory: string,
  approvalRules: ApprovalRule[],
): boolean {
  const absolutePath = path.isAbsolute(searchPath)
    ? searchPath
    : path.resolve(workingDirectory, searchPath);

  for (const rule of approvalRules) {
    if (rule.type === "path-glob" && rule.tool === "glob") {
      if (pathMatchesGlob(absolutePath, rule.glob, workingDirectory)) {
        return true;
      }
    }
  }
  return false;
}

export const globTool = () =>
  tool({
    needsApproval: (args, { experimental_context }) => {
      const ctx = getApprovalContext(experimental_context);
      // If no path is provided, it defaults to working directory (no approval needed)
      if (!args.path) {
        return false;
      }
      const absolutePath = path.isAbsolute(args.path)
        ? args.path
        : path.resolve(ctx.workingDirectory, args.path);
      // Check if within working directory - no approval needed
      if (isPathWithinDirectory(absolutePath, ctx.workingDirectory)) {
        return false;
      }
      // Outside working directory - check if a rule matches
      if (
        pathMatchesApprovalRule(
          args.path,
          ctx.workingDirectory,
          ctx.approvalRules,
        )
      ) {
        return false;
      }
      return true;
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
      const sandbox = getSandbox(experimental_context);
      const workingDirectory = sandbox.workingDirectory;

      try {
        // Resolve search directory relative to working directory
        let searchDir: string;
        if (basePath) {
          searchDir = path.isAbsolute(basePath)
            ? basePath
            : path.resolve(workingDirectory, basePath);
        } else {
          searchDir = workingDirectory;
        }

        const files = await findFiles(searchDir, pattern, limit, sandbox);

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
