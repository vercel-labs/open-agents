import * as path from "path";
import type { Sandbox } from "@open-agents/sandbox";
import {
  skillFrontmatterSchema,
  frontmatterToOptions,
  type SkillMetadata,
} from "./types";

/**
 * Built-in commands that skills cannot shadow.
 * Skills with these names will be unreachable via slash command.
 */
const BUILTIN_COMMANDS = ["model", "resume", "new"];

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Returns null if frontmatter is missing or invalid.
 *
 * Expected format:
 * ---
 * name: skill-name
 * description: Short description
 * ---
 */
export function parseSkillFrontmatter(
  content: string,
): ReturnType<typeof skillFrontmatterSchema.safeParse> {
  // Match YAML frontmatter between --- markers
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) {
    return {
      success: false,
      error: new Error("No frontmatter found") as never,
    };
  }

  const yaml = match[1];
  const parsed: Record<string, unknown> = {};

  // Simple YAML parser for frontmatter
  // Handles: key: value, key: "quoted value", multiline not supported
  for (const line of yaml.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    // Only split on the first colon to preserve colons in values (e.g., URLs)
    let value: string | boolean = trimmed.slice(colonIndex + 1).trim();

    // Handle quoted strings (including escaped quotes inside)
    if (value.startsWith('"') && value.endsWith('"')) {
      const inner = value.slice(1, -1);
      // Unescape escaped quotes: \" -> "
      value = inner.replace(/\\"/g, '"');
    } else if (value.startsWith("'") && value.endsWith("'")) {
      const inner = value.slice(1, -1);
      // Unescape escaped quotes: \' -> '
      value = inner.replace(/\\'/g, "'");
    } else {
      // Parse booleans only for unquoted values
      if (value === "true") {
        value = true;
      } else if (value === "false") {
        value = false;
      }
    }

    parsed[key] = value;
  }

  return skillFrontmatterSchema.safeParse(parsed);
}

/**
 * Find the SKILL.md file in a directory.
 * Prefers uppercase SKILL.md over lowercase skill.md.
 * Returns null if neither exists.
 */
async function findSkillFile(
  sandbox: Sandbox,
  skillDir: string,
): Promise<string | null> {
  const uppercasePath = path.join(skillDir, "SKILL.md");
  const lowercasePath = path.join(skillDir, "skill.md");

  try {
    await sandbox.access(uppercasePath);
    return uppercasePath;
  } catch {
    // Uppercase not found, try lowercase
  }

  try {
    await sandbox.access(lowercasePath);
    return lowercasePath;
  } catch {
    // Neither found
    return null;
  }
}

/**
 * Discover skills from the given directories using sandbox interface.
 * Scans each directory for subdirectories containing SKILL.md files.
 *
 * @param sandbox - Sandbox interface for file operations
 * @param directories - List of directories to scan for skills
 * @returns Array of skill metadata (name, description, path, options)
 */
export async function discoverSkills(
  sandbox: Sandbox,
  directories: string[],
): Promise<SkillMetadata[]> {
  const skills: SkillMetadata[] = [];
  const seenNames = new Set<string>();

  for (const dir of directories) {
    // Check if directory exists
    try {
      const stat = await sandbox.stat(dir);
      if (!stat.isDirectory()) continue;
    } catch {
      // Directory doesn't exist, skip
      continue;
    }

    // List subdirectories
    let entries;
    try {
      entries = await sandbox.readdir(dir, { withFileTypes: true });
    } catch {
      // Can't read directory, skip
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Check for SKILL.md or skill.md
      const skillDir = path.join(dir, entry.name);
      const skillFile = await findSkillFile(sandbox, skillDir);
      if (!skillFile) continue;

      // Read and parse frontmatter only
      let content: string;
      try {
        content = await sandbox.readFile(skillFile, "utf-8");
      } catch {
        // Can't read file, skip
        continue;
      }

      const result = parseSkillFrontmatter(content);
      if (!result.success) {
        // Invalid frontmatter, skip
        continue;
      }

      const frontmatter = result.data;

      // Skip skills that shadow built-in commands (they would be unreachable)
      if (BUILTIN_COMMANDS.includes(frontmatter.name.toLowerCase())) {
        console.warn(
          `Warning: Skill "${frontmatter.name}" in ${skillDir} shadows built-in command /${frontmatter.name}. Skipping.`,
        );
        continue;
      }

      // Skip duplicate skill names (first one wins, case-insensitive)
      const normalizedName = frontmatter.name.toLowerCase();
      if (seenNames.has(normalizedName)) {
        continue;
      }
      seenNames.add(normalizedName);

      skills.push({
        name: frontmatter.name,
        description: frontmatter.description,
        path: skillDir,
        filename: path.basename(skillFile),
        options: frontmatterToOptions(frontmatter),
      });
    }
  }

  return skills;
}
