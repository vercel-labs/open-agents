import { expect, test } from "bun:test";
import {
  countLines,
  createPasteToken,
  expandPasteTokens,
  extractPasteTokens,
  formatPastePlaceholder,
  type PasteBlock,
} from "./paste-blocks";

test("countLines handles newline variants", () => {
  expect(countLines("a\nb\nc")).toBe(3);
  expect(countLines("a\r\nb")).toBe(2);
});

test("formatPastePlaceholder pluralizes line label", () => {
  expect(formatPastePlaceholder(1, 1)).toBe("[Pasted text #1 +1 line]");
  expect(formatPastePlaceholder(2, 3)).toBe("[Pasted text #2 +3 lines]");
});

test("expandPasteTokens replaces tokens with pasted text", () => {
  const token = createPasteToken(1);
  const blocks = new Map<string, PasteBlock>([
    [token, { id: 1, token, text: "A\nB", lineCount: 2 }],
  ]);
  expect(expandPasteTokens(`x${token}y`, blocks)).toBe("xA\nBy");
});

test("extractPasteTokens finds tokens in value", () => {
  const token1 = createPasteToken(2);
  const token2 = createPasteToken(3);
  const tokens = extractPasteTokens(`a${token1}b${token2}`);
  expect(tokens.has(token1)).toBe(true);
  expect(tokens.has(token2)).toBe(true);
  expect(tokens.size).toBe(2);
});
