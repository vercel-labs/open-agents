/**
 * CLI syntax highlighter using cli-highlight.
 * This is TUI-specific and wraps the shared diff utilities.
 */
import { highlight } from "cli-highlight";
import type { Highlighter } from "@open-harness/shared";

export const cliHighlighter: Highlighter = (code, language) => {
  return highlight(code, {
    language: language || undefined,
    ignoreIllegals: true,
  });
};
