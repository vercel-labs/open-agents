/**
 * Shared diff utilities for rendering file changes in the TUI.
 * Used by both tool-call renderers and approval-panel.
 */

// Display constants
export const DIFF_MAX_WRITE_LINES = 10;
export const DIFF_MAX_EDIT_LINES = 15;
export const DIFF_LINE_MAX_WIDTH = 80;

export type DiffLine = {
  type: "context" | "addition" | "removal" | "separator";
  lineNumber?: number;
  content: string;
};

/**
 * Create diff lines for a write (new file) operation.
 * Shows all lines as additions, with truncation for large files.
 */
export function createWriteDiffLines(
  content: string,
  maxLines: number = DIFF_MAX_WRITE_LINES,
): DiffLine[] {
  if (!content) return [];

  const contentLines = content.split("\n");
  // Handle empty string case where split returns [""]
  if (contentLines.length === 1 && contentLines[0] === "") return [];

  const result: DiffLine[] = [];

  if (contentLines.length <= maxLines) {
    contentLines.forEach((line, i) => {
      result.push({ type: "addition", lineNumber: i + 1, content: line });
    });
  } else {
    // Show first few and last few lines with separator
    const showStart = Math.floor(maxLines / 2);
    const showEnd = maxLines - showStart;

    for (let i = 0; i < showStart; i++) {
      const line = contentLines[i];
      if (line !== undefined) {
        result.push({ type: "addition", lineNumber: i + 1, content: line });
      }
    }

    result.push({ type: "separator", content: "..." });

    for (let i = contentLines.length - showEnd; i < contentLines.length; i++) {
      const line = contentLines[i];
      if (line !== undefined) {
        result.push({ type: "addition", lineNumber: i + 1, content: line });
      }
    }
  }

  return result;
}

/**
 * Create diff lines for an edit operation.
 * Shows removals followed by additions, with truncation for large diffs.
 */
export function createEditDiffLines(
  oldString: string,
  newString: string,
  startLine: number = 1,
  maxLines: number = DIFF_MAX_EDIT_LINES,
): { lines: DiffLine[]; additions: number; removals: number } {
  // Handle empty strings
  const oldLines =
    oldString && !(oldString.split("\n").length === 1 && oldString === "")
      ? oldString.split("\n")
      : [];
  const newLines =
    newString && !(newString.split("\n").length === 1 && newString === "")
      ? newString.split("\n")
      : [];

  const removals = oldLines.length;
  const additions = newLines.length;

  const allLines: DiffLine[] = [];

  oldLines.forEach((line, i) => {
    allLines.push({
      type: "removal",
      lineNumber: startLine + i,
      content: line,
    });
  });

  newLines.forEach((line, i) => {
    allLines.push({
      type: "addition",
      lineNumber: startLine + i,
      content: line,
    });
  });

  // Limit total lines
  if (allLines.length <= maxLines) {
    return { lines: allLines, additions, removals };
  }

  // Show first portion and last portion with separator
  const result: DiffLine[] = [];
  const half = Math.floor(maxLines / 2);
  for (let i = 0; i < half; i++) {
    const line = allLines[i];
    if (line) result.push(line);
  }
  result.push({ type: "separator", content: "..." });
  for (let i = allLines.length - half; i < allLines.length; i++) {
    const line = allLines[i];
    if (line) result.push(line);
  }

  return { lines: result, additions, removals };
}
