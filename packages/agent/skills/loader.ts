/**
 * Extract the body content from a SKILL.md file.
 * Strips the YAML frontmatter and returns only the markdown body.
 *
 * @param fileContent - Full content of SKILL.md file
 * @returns The body content after frontmatter
 */
export function extractSkillBody(fileContent: string): string {
  // Match and remove YAML frontmatter between --- markers
  const match = fileContent.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (match) {
    return fileContent.slice(match[0].length).trim();
  }
  // No frontmatter found, return entire content
  return fileContent.trim();
}

/**
 * Substitute $ARGUMENTS placeholder with actual arguments.
 * Replaces all occurrences of $ARGUMENTS with the provided args.
 *
 * @param body - Skill body content with potential $ARGUMENTS placeholders
 * @param args - Arguments to substitute, or undefined for empty string
 * @returns Body with $ARGUMENTS replaced
 */
export function substituteArguments(body: string, args?: string): string {
  return body.replace(/\$ARGUMENTS/g, args ?? "");
}

/**
 * Inject skill directory path into the body content.
 * This allows Claude to construct full paths to scripts and resources.
 *
 * @param body - Skill body content
 * @param skillDir - Absolute path to the skill directory
 * @returns Body with skill directory info prepended
 */
export function injectSkillDirectory(body: string, skillDir: string): string {
  return `Skill directory: ${skillDir}\n\n${body}`;
}
