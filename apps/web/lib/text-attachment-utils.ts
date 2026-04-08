export type TextAttachment = {
  id: string;
  content: string;
  filename: string;
  /** Number of lines in the content */
  lineCount: number;
  /** Size in bytes (UTF-8 encoded) */
  byteSize: number;
};

/**
 * Minimum character count for pasted text to be auto-converted to a file
 * attachment. Roughly ~12 lines of 40 chars or a dense log snippet.
 */
export const LARGE_TEXT_CHAR_THRESHOLD = 500;

/**
 * Minimum number of lines for pasted text to be auto-converted to a file
 * attachment, regardless of total character count.
 */
export const LARGE_TEXT_LINE_THRESHOLD = 10;

/** Returns `true` when pasted text is large enough to warrant file-attachment treatment. */
export function isLargeText(text: string): boolean {
  if (text.length >= LARGE_TEXT_CHAR_THRESHOLD) return true;
  // Count newlines – a fast proxy for line count.
  let lines = 1;
  for (const ch of text) {
    if (ch === "\n") {
      lines++;
      if (lines >= LARGE_TEXT_LINE_THRESHOLD) return true;
    }
  }
  return false;
}

/**
 * Try to infer a reasonable filename from the pasted content.
 * Falls back to "pasted-text.txt".
 */
export function inferFilename(text: string): string {
  const trimmed = text.trimStart();

  // JSON object/array
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return "pasted.json";
    } catch {
      // Not valid JSON – fall through
    }
  }

  // Common log patterns
  if (
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(trimmed) ||
    /^(ERROR|WARN|INFO|DEBUG|TRACE)\b/i.test(trimmed) ||
    /^Run /m.test(trimmed)
  ) {
    return "pasted.log";
  }

  // Stack trace
  if (
    /^\s*at\s+/.test(trimmed) ||
    /Traceback \(most recent call/i.test(trimmed)
  ) {
    return "pasted.log";
  }

  // YAML-like
  if (/^[\w-]+:\s/.test(trimmed) && trimmed.includes("\n")) {
    return "pasted.yaml";
  }

  return "pasted.txt";
}

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
