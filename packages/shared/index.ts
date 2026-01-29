// Hooks

export {
  ExpandedViewProvider,
  useExpandedView,
} from "./hooks/expanded-view-context";
export {
  ReasoningProvider,
  type ThinkingState,
  useReasoningContext,
} from "./hooks/reasoning-context";

export { TodoViewProvider, useTodoView } from "./hooks/todo-view-context";
// Lib - Diff utilities
export {
  type CodeLine,
  createEditDiffLines,
  createNewFileCodeLines,
  createUnifiedDiff,
  DIFF_LINE_MAX_WIDTH,
  DIFF_MAX_EDIT_LINES,
  type DiffLine,
  getLanguageFromPath,
  type Highlighter,
  NEW_FILE_MAX_LINES,
  splitLines,
  type UnifiedDiffResult,
} from "./lib/diff";
// Lib - Paste blocks
export {
  countLines,
  createPasteToken,
  expandPasteTokens,
  extractPasteTokens,
  formatPastePlaceholder,
  isPasteTokenChar,
  PASTE_TOKEN_BASE,
  PASTE_TOKEN_END,
  type PasteBlock,
} from "./lib/paste-blocks";

// Lib - Tool state utilities
export {
  extractRenderState,
  formatTokens,
  type GenericToolPart,
  getStatusColor,
  getStatusLabel,
  type ToolRenderState,
  toRelativePath,
} from "./lib/tool-state";
