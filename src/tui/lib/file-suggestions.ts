import { spawn } from "node:child_process";
import type { Suggestion } from "../components/suggestions.js";

// Cache for all files to avoid repeated filesystem scans
let cachedFiles: Suggestion[] | null = null;
let cacheTime = 0;
let cachedCwd: string | null = null;
const CACHE_TTL = 30_000; // 30 seconds

/**
 * Get files using git ls-files (much faster than recursive readdir)
 */
async function getGitFiles(cwd: string): Promise<Suggestion[]> {
  return new Promise((resolve) => {
    const results: Suggestion[] = [];
    const seenDirs = new Set<string>();

    const proc = spawn("git", ["ls-files"], { cwd });
    let output = "";

    proc.stdout.on("data", (data) => {
      output += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        resolve([]);
        return;
      }

      const files = output.trim().split("\n").filter(Boolean);

      for (const file of files) {
        // Add parent directories
        const parts = file.split("/");
        let dirPath = "";
        for (let i = 0; i < parts.length - 1; i++) {
          dirPath = dirPath ? dirPath + "/" + parts[i] : parts[i]!;
          if (!seenDirs.has(dirPath)) {
            seenDirs.add(dirPath);
            results.push({
              value: dirPath + "/",
              display: dirPath + "/",
              isDirectory: true,
            });
          }
        }

        // Add the file
        results.push({
          value: file,
          display: file,
          isDirectory: false,
        });
      }

      // Sort: directories first, then alphabetically
      results.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.display.localeCompare(b.display);
      });

      resolve(results);
    });

    proc.on("error", () => {
      resolve([]);
    });

    // Timeout after 2 seconds
    setTimeout(() => {
      proc.kill();
      resolve([]);
    }, 2000);
  });
}

/**
 * Get all files with caching
 */
async function getCachedFiles(cwd: string): Promise<Suggestion[]> {
  const now = Date.now();
  if (cachedFiles && cachedCwd === cwd && now - cacheTime < CACHE_TTL) {
    return cachedFiles;
  }

  cachedFiles = await getGitFiles(cwd);
  cacheTime = now;
  cachedCwd = cwd;

  return cachedFiles;
}

/**
 * Get file and directory suggestions based on a partial path
 * Returns max 50 results for performance
 */
export async function getFileSuggestions(
  partialPath: string,
  cwd: string = process.cwd(),
): Promise<Suggestion[]> {
  const allFiles = await getCachedFiles(cwd);
  const query = partialPath.toLowerCase();
  const maxResults = 50;

  if (!query) {
    // Show top-level items when no query
    const results: Suggestion[] = [];
    for (const f of allFiles) {
      if (
        !f.value.includes("/") ||
        (f.isDirectory && !f.value.slice(0, -1).includes("/"))
      ) {
        results.push(f);
        if (results.length >= maxResults) break;
      }
    }
    return results;
  }

  // Filter files that match the query, stop early once we have enough
  const results: Suggestion[] = [];
  for (const f of allFiles) {
    if (f.value.toLowerCase().includes(query)) {
      results.push(f);
      if (results.length >= maxResults) break;
    }
  }
  return results;
}

/**
 * Extract the @ mention from input text
 * Returns the partial path after @ or null if not in a mention
 */
export function extractMention(
  text: string,
  cursorPosition: number,
): { mentionStart: number; partialPath: string } | null {
  // Find the @ symbol before cursor
  let atIndex = -1;
  for (let i = cursorPosition - 1; i >= 0; i--) {
    const char = text[i];
    // Stop at whitespace - no mention
    if (char === " " || char === "\t" || char === "\n") {
      break;
    }
    if (char === "@") {
      atIndex = i;
      break;
    }
  }

  if (atIndex === -1) {
    return null;
  }

  const partialPath = text.slice(atIndex + 1, cursorPosition);
  return { mentionStart: atIndex, partialPath };
}
