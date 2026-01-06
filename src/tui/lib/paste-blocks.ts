export const PASTE_TOKEN_BASE = 0xe000;
export const PASTE_TOKEN_END = 0xf8ff;

export type PasteBlock = {
  id: number;
  token: string;
  text: string;
  lineCount: number;
};

export function createPasteToken(id: number): string {
  const code = PASTE_TOKEN_BASE + id;
  if (code > PASTE_TOKEN_END) {
    throw new Error("Paste token limit reached.");
  }
  return String.fromCharCode(code);
}

export function isPasteTokenChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= PASTE_TOKEN_BASE && code <= PASTE_TOKEN_END;
}

export function extractPasteTokens(value: string): Set<string> {
  const tokens = new Set<string>();
  for (const char of value) {
    if (isPasteTokenChar(char)) {
      tokens.add(char);
    }
  }
  return tokens;
}

export function expandPasteTokens(
  value: string,
  blocksByToken: Map<string, PasteBlock>,
): string {
  let result = "";
  for (const char of value) {
    if (isPasteTokenChar(char)) {
      const block = blocksByToken.get(char);
      if (block) {
        result += block.text;
      }
    } else {
      result += char;
    }
  }
  return result;
}

export function countLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r\n|\r|\n/).length;
}

export function formatPastePlaceholder(id: number, lineCount: number): string {
  const label = lineCount === 1 ? "line" : "lines";
  return `[Pasted text #${id} +${lineCount} ${label}]`;
}
