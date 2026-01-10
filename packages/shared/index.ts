// Hooks
export {
  ReasoningProvider,
  useReasoningContext,
  type ThinkingState,
} from "./hooks/reasoning-context.js";

export {
  ExpandedViewProvider,
  useExpandedView,
} from "./hooks/expanded-view-context.js";

export { TodoViewProvider, useTodoView } from "./hooks/todo-view-context.js";

// Lib - Paste blocks
export {
  PASTE_TOKEN_BASE,
  PASTE_TOKEN_END,
  type PasteBlock,
  createPasteToken,
  isPasteTokenChar,
  extractPasteTokens,
  expandPasteTokens,
  countLines,
  formatPastePlaceholder,
} from "./lib/paste-blocks.js";

// Lib - Diff utilities
export {
  DIFF_MAX_EDIT_LINES,
  DIFF_LINE_MAX_WIDTH,
  NEW_FILE_MAX_LINES,
  type DiffLine,
  type CodeLine,
  type Highlighter,
  splitLines,
  createEditDiffLines,
  getLanguageFromPath,
  createNewFileCodeLines,
} from "./lib/diff.js";

// Lib - Tool state utilities
export {
  type ToolRenderState,
  type GenericToolPart,
  extractRenderState,
  getStatusColor,
  getStatusLabel,
  toRelativePath,
} from "./lib/tool-state.js";
