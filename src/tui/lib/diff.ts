/**
 * Shared diff utilities for rendering file changes in the TUI.
 * Used by both tool-call renderers and approval-panel.
 */
import { highlight } from "cli-highlight";

// Display constants
export const DIFF_MAX_EDIT_LINES = 15;
export const DIFF_LINE_MAX_WIDTH = 80;

export type DiffLine = {
  type: "context" | "addition" | "removal" | "separator";
  lineNumber?: number;
  content: string;
};

/**
 * Split content into lines, removing trailing empty line from files ending with newline.
 * "hello\n".split("\n") -> ["hello", ""], but we want ["hello"].
 */
function splitLines(content: string): string[] {
  if (!content) return [];
  const lines = content.split("\n");
  if (lines.length === 1 && lines[0] === "") return [];
  // Remove trailing empty line from files ending with newline
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    return lines.slice(0, -1);
  }
  return lines;
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
  const oldLines = splitLines(oldString);
  const newLines = splitLines(newString);

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

/**
 * Get the language identifier from a file path for syntax highlighting.
 */
export function getLanguageFromPath(filePath: string): string | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return undefined;

  const extToLang: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    md: "markdown",
    py: "python",
    rb: "ruby",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    css: "css",
    scss: "scss",
    html: "html",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    sql: "sql",
    graphql: "graphql",
    vue: "vue",
    svelte: "svelte",
  };

  return extToLang[ext];
}

export type CodeLine = {
  content: string;
  highlighted: string;
};

// Max lines to display for new file preview
export const NEW_FILE_MAX_LINES = 200;

/**
 * Create code lines for displaying a new file with syntax highlighting.
 * Returns plain content and highlighted version for each line.
 * Truncates to MAX_LINES for performance, showing first lines only.
 */
export function createNewFileCodeLines(
  content: string,
  filePath: string,
  maxLines: number = NEW_FILE_MAX_LINES,
): { lines: CodeLine[]; totalLines: number; hiddenLines: number } {
  const contentLines = splitLines(content);
  if (contentLines.length === 0) {
    return { lines: [], totalLines: 0, hiddenLines: 0 };
  }

  const totalLines = contentLines.length;
  const linesToShow = contentLines.slice(0, maxLines);
  const hiddenLines = Math.max(0, totalLines - maxLines);
  const language = getLanguageFromPath(filePath);

  // Highlight only the lines we're showing
  const codeToHighlight = linesToShow.join("\n");
  let highlightedCode: string;

  try {
    highlightedCode = highlight(codeToHighlight, {
      language: language || undefined,
      ignoreIllegals: true,
    });
  } catch {
    highlightedCode = codeToHighlight;
  }

  const highlightedLines = highlightedCode.split("\n");
  const result: CodeLine[] = linesToShow.map((line, i) => ({
    content: line,
    highlighted: highlightedLines[i] ?? line,
  }));

  return { lines: result, totalLines, hiddenLines };
}
