import type { FileSuggestion } from "@/app/api/sessions/[sessionId]/files/route";

/**
 * Extract the @ mention from input text at the cursor position
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
    if (char === undefined) break;
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

/**
 * Filter file suggestions based on a partial path
 * Returns max results for performance
 */
export function filterFileSuggestions(
  files: FileSuggestion[],
  partialPath: string,
  maxResults: number = 50,
): FileSuggestion[] {
  const query = partialPath.toLowerCase();

  if (!query) {
    // Show top-level items when no query
    const results: FileSuggestion[] = [];
    for (const f of files) {
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

  // Filter files that match the query
  const results: FileSuggestion[] = [];
  for (const f of files) {
    if (f.value.toLowerCase().includes(query)) {
      results.push(f);
      if (results.length >= maxResults) break;
    }
  }
  return results;
}
