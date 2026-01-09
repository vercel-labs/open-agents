import * as path from "path";
import * as fs from "fs/promises";

/**
 * Supported filenames for agents.md files.
 * AGENTS.md is the standard, but we also support lowercase for flexibility.
 */
const AGENTS_MD_FILENAMES = ["AGENTS.md", "agents.md"];

/**
 * Result of loading agents.md files.
 */
export interface AgentsMdResult {
  /** Combined content from all found agents.md files */
  content: string;
  /** Paths to all found agents.md files (closest first) */
  files: string[];
}

/**
 * Search for agents.md files from a directory up to the filesystem root.
 * Returns all found files with the closest file first.
 *
 * @param startDirectory - Directory to start searching from
 * @returns Array of absolute paths to found agents.md files (closest first)
 */
async function findAgentsMdFiles(startDirectory: string): Promise<string[]> {
  const foundFiles: string[] = [];
  let currentDir = path.resolve(startDirectory);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    for (const filename of AGENTS_MD_FILENAMES) {
      const filePath = path.join(currentDir, filename);
      try {
        const stat = await fs.stat(filePath);
        if (stat.isFile()) {
          foundFiles.push(filePath);
          break; // Only take one file per directory (prefer AGENTS.md over agents.md)
        }
      } catch {
        // File doesn't exist, continue searching
      }
    }
    currentDir = path.dirname(currentDir);
  }

  // Check root directory as well
  for (const filename of AGENTS_MD_FILENAMES) {
    const filePath = path.join(root, filename);
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        foundFiles.push(filePath);
        break;
      }
    } catch {
      // File doesn't exist
    }
  }

  return foundFiles;
}

/**
 * Load and combine content from all agents.md files found in the directory hierarchy.
 *
 * The agents.md format (https://agents.md) is an open standard for providing
 * context and instructions to AI coding agents. Files closer to the working
 * directory take precedence, with their content appearing first.
 *
 * @param workingDirectory - The directory to start searching from
 * @returns Combined content and list of files found, or null if no files found
 */
export async function loadAgentsMd(
  workingDirectory: string,
): Promise<AgentsMdResult | null> {
  const files = await findAgentsMdFiles(workingDirectory);

  if (files.length === 0) {
    return null;
  }

  const contents: string[] = [];

  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      if (content.trim()) {
        // Add file path as a comment for context
        contents.push(`<!-- From: ${filePath} -->\n${content.trim()}`);
      }
    } catch {
      // Skip files that can't be read
    }
  }

  if (contents.length === 0) {
    return null;
  }

  return {
    content: contents.join("\n\n---\n\n"),
    files,
  };
}
