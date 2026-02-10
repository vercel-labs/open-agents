import { truncateText } from "./truncate";

function isCodeFence(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("```") || trimmed.startsWith("~~~");
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  return /^\|?[\s:-]+\|?[\s|:-]*$/.test(trimmed);
}

function isTableLine(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  if (!line || !line.includes("|")) return false;
  const prev = index > 0 ? (lines[index - 1] ?? "") : "";
  const next = index + 1 < lines.length ? (lines[index + 1] ?? "") : "";
  return (
    isTableSeparatorLine(line) ||
    isTableSeparatorLine(prev) ||
    isTableSeparatorLine(next)
  );
}

function countTableCells(line: string): number {
  if (!line.includes("|")) return 0;
  const parts = line.split("|");
  let start = 0;
  let end = parts.length;
  if ((parts[start] ?? "").trim() === "") start += 1;
  if (end > start && (parts[end - 1] ?? "").trim() === "") end -= 1;
  return Math.max(0, end - start);
}

function stripEdgePipes(text: string): string {
  let trimmed = text.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1).trimStart();
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1).trimEnd();
  return trimmed;
}

function mergeTableLine(currentRow: string, nextLine: string): string {
  const continuation = stripEdgePipes(nextLine);
  if (!continuation) return currentRow;
  const trailingPipeMatch = currentRow.match(/\|\s*$/);
  if (trailingPipeMatch) {
    const lastPipeIndex = currentRow.lastIndexOf("|");
    if (lastPipeIndex >= 0) {
      const prefix = currentRow.slice(0, lastPipeIndex).trimEnd();
      const suffix = currentRow.slice(lastPipeIndex);
      return `${prefix} ${continuation}${suffix}`;
    }
  }
  return `${currentRow.trimEnd()} ${continuation}`;
}

function normalizeTableRows(
  lines: string[],
  startIndex: number,
): { rowLines: string[]; endIndex: number } {
  const headerLine = lines[startIndex] ?? "";
  const separatorLine = lines[startIndex + 1] ?? "";
  const expectedCells = Math.max(
    1,
    Math.max(countTableCells(headerLine), countTableCells(separatorLine)),
  );
  const headerLeadingPipe = headerLine.trimStart().startsWith("|");
  const headerTrailingPipe = headerLine.trimEnd().endsWith("|");
  const rowLines: string[] = [];
  let currentRow: string | null = null;
  let rowIndex = startIndex + 2;

  const lineLooksLikeRowStart = (line: string): boolean => {
    if (!line.includes("|")) return false;
    const trimmed = line.trim();
    if (headerLeadingPipe && !trimmed.startsWith("|")) return false;
    if (headerTrailingPipe && !trimmed.endsWith("|")) return false;
    return countTableCells(line) >= expectedCells;
  };

  while (rowIndex < lines.length) {
    const line = lines[rowIndex] ?? "";
    if (!line.trim()) break;
    if (isCodeFence(line)) break;
    if (!line.includes("|") && currentRow === null) break;

    if (currentRow === null) {
      currentRow = line;
      rowIndex += 1;
      continue;
    }

    const currentHasCells = countTableCells(currentRow) >= expectedCells;
    if (currentHasCells && lineLooksLikeRowStart(line)) {
      rowLines.push(currentRow);
      currentRow = line;
      rowIndex += 1;
      continue;
    }

    currentRow = mergeTableLine(currentRow, line);
    rowIndex += 1;
  }

  if (currentRow) rowLines.push(currentRow);

  return { rowLines, endIndex: rowIndex };
}

function wrapWords(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      if (word.length <= maxWidth) {
        current = word;
      } else {
        lines.push(...splitLongWord(word, maxWidth));
      }
      continue;
    }
    if (current.length + 1 + word.length <= maxWidth) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      if (word.length <= maxWidth) {
        current = word;
      } else {
        const parts = splitLongWord(word, maxWidth);
        lines.push(...parts.slice(0, -1));
        current = parts[parts.length - 1] ?? "";
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

function splitLongWord(word: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [word];
  const parts: string[] = [];
  let index = 0;
  while (index < word.length) {
    parts.push(word.slice(index, index + maxWidth));
    index += maxWidth;
  }
  return parts;
}

function wrapLine(line: string, maxWidth: number): string[] {
  if (line.length <= maxWidth) return [line];
  const indentMatch = line.match(/^\s*/);
  const indent = indentMatch ? (indentMatch[0] ?? "") : "";
  const trimmed = line.trim();
  const availableWidth = Math.max(1, maxWidth - indent.length);
  const wrapped = wrapWords(trimmed, availableWidth);
  return wrapped.map((chunk, index) =>
    index === 0 ? `${indent}${chunk}` : `${indent}${chunk}`,
  );
}

function wrapPrefixedLine(
  line: string,
  prefixPattern: RegExp,
  maxWidth: number,
): string[] {
  const match = line.match(prefixPattern);
  if (!match || !match[0]) return wrapLine(line, maxWidth);
  const prefix = match[0];
  const rest = line.slice(prefix.length).trim();
  const availableWidth = Math.max(1, maxWidth - prefix.length);
  const wrapped = wrapWords(rest, availableWidth);
  if (wrapped.length === 0) return [prefix.trimEnd()];
  const lines = wrapped.map((chunk, index) =>
    index === 0 ? `${prefix}${chunk}` : `${" ".repeat(prefix.length)}${chunk}`,
  );
  return lines;
}

export function wrapMarkdown(content: string, maxWidth: number): string {
  if (maxWidth <= 0) return content;
  const lines = content.split("\n");
  const result: string[] = [];
  let inCodeFence = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (isCodeFence(line)) {
      inCodeFence = !inCodeFence;
      result.push(line);
      continue;
    }
    if (inCodeFence) {
      result.push(line);
      continue;
    }
    if (!line.trim()) {
      result.push("");
      continue;
    }
    const nextLine = lines[i + 1] ?? "";
    if (isTableSeparatorLine(nextLine)) {
      const headerLine = line;
      const { rowLines, endIndex } = normalizeTableRows(lines, i);
      result.push(truncateText(headerLine, maxWidth));
      result.push(truncateText(nextLine, maxWidth));
      rowLines.forEach((rowLine) => {
        result.push(truncateText(rowLine, maxWidth));
      });
      i = endIndex - 1;
      continue;
    }
    if (isTableLine(lines, i)) {
      result.push(truncateText(line, maxWidth));
      continue;
    }
    if (line.trimStart().startsWith(">")) {
      const wrapped = wrapPrefixedLine(line, /^\s*>\s?/, maxWidth);
      result.push(...wrapped);
      continue;
    }
    if (/^\s*([-*+]\s+)/.test(line)) {
      const wrapped = wrapPrefixedLine(line, /^\s*([-*+]\s+)/, maxWidth);
      result.push(...wrapped);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const wrapped = wrapPrefixedLine(line, /^\s*\d+\.\s+/, maxWidth);
      result.push(...wrapped);
      continue;
    }
    result.push(...wrapLine(line, maxWidth));
  }

  return result.join("\n");
}
