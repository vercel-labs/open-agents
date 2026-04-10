/**
 * Shared tool state extraction utilities.
 * Platform-agnostic - can be used by both TUI and web app.
 */

/**
 * Common state derived from a tool part for renderers.
 */
export type ToolRenderState = {
  /** Whether the tool is currently running */
  running: boolean;
  /** Whether the tool was interrupted (running when stream stopped) */
  interrupted: boolean;
  /** Error message if the tool failed */
  error?: string;
  /** Whether the tool was denied by the user */
  denied: boolean;
  /** Reason for denial if provided */
  denialReason?: string;
  /** Whether approval is being requested */
  approvalRequested: boolean;
  /** Approval ID if approval is requested */
  approvalId?: string;
  /** Whether this is the currently active approval */
  isActiveApproval: boolean;
};

/**
 * Generic tool part type that works with any tool configuration.
 * Uses a loose type to allow any tool UI part shape.
 */
export type GenericToolPart = {
  state: string;
  approval?: {
    id?: string;
    approved?: boolean;
    reason?: string;
  };
  errorText?: string;
  input?: unknown;
  output?: unknown;
};

/**
 * Extract render state from a tool part.
 */
export function extractRenderState(
  part: GenericToolPart,
  activeApprovalId: string | null,
  isStreaming: boolean,
): ToolRenderState {
  const isRunningState =
    part.state === "input-streaming" || part.state === "input-available";
  const approval = part.approval;
  const denied = part.state === "output-denied" || approval?.approved === false;
  const denialReason = denied ? approval?.reason : undefined;
  const approvalRequested = part.state === "approval-requested" && !denied;
  const error = part.state === "output-error" ? part.errorText : undefined;
  const approvalId = approvalRequested ? approval?.id : undefined;
  const isActiveApproval =
    approvalId != null && approvalId === activeApprovalId;

  // Tool was running but stream stopped - it was interrupted
  const interrupted = isRunningState && !isStreaming;
  const running = isRunningState && isStreaming;

  return {
    running,
    interrupted,
    error,
    denied,
    denialReason,
    approvalRequested,
    approvalId,
    isActiveApproval,
  };
}

/**
 * Get the status color based on tool state.
 */
export function getStatusColor(
  state: ToolRenderState,
): "red" | "yellow" | "green" {
  if (state.denied) return "red";
  if (state.interrupted) return "yellow";
  if (state.approvalRequested) return "yellow";
  if (state.running) return "yellow";
  if (state.error) return "red";
  return "green";
}

const MAX_ERROR_DISPLAY_LENGTH = 80;

/**
 * Get the status label based on tool state.
 */
export function getStatusLabel(state: ToolRenderState): string | undefined {
  if (state.denied) {
    return state.denialReason ? `Denied: ${state.denialReason}` : "Denied";
  }
  if (state.interrupted) {
    return "Interrupted";
  }
  if (state.approvalRequested) {
    return "Waiting for approval…";
  }
  if (state.running) {
    return "Running…";
  }
  if (state.error) {
    return `Error: ${state.error.slice(0, MAX_ERROR_DISPLAY_LENGTH)}`;
  }
  return undefined;
}

/**
 * Helper to convert absolute file path to relative path for display.
 */
export function toRelativePath(filePath: string, cwd: string): string {
  const cwdPrefix = cwd.endsWith("/") ? cwd : cwd + "/";

  if (filePath.startsWith(cwdPrefix)) {
    return filePath.slice(cwdPrefix.length);
  }
  if (filePath === cwd) {
    return ".";
  }
  return filePath;
}

/**
 * Format token count for display.
 * Examples: 500 → "500", 1200 → "1.2k", 999950 → "1.0m", 2500000000 → "2.5b"
 *
 * Uses 999.95 as the promotion threshold so .toFixed(1) rounding never
 * produces "1000.0k" or "1000.0m" — those values get bumped to the next unit.
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 999_950_000_000)
    return `${(tokens / 1_000_000_000_000).toFixed(1)}t`;
  if (tokens >= 999_950_000) return `${(tokens / 1_000_000_000).toFixed(1)}b`;
  if (tokens >= 999_950) return `${(tokens / 1_000_000).toFixed(1)}m`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return tokens.toLocaleString();
}
