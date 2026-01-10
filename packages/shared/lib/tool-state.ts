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
): ToolRenderState {
  const running =
    part.state === "input-streaming" || part.state === "input-available";
  const approval = part.approval;
  const denied = part.state === "output-denied" || approval?.approved === false;
  const denialReason = denied ? approval?.reason : undefined;
  const approvalRequested = part.state === "approval-requested" && !denied;
  const error = part.state === "output-error" ? part.errorText : undefined;
  const approvalId = approvalRequested ? approval?.id : undefined;
  const isActiveApproval =
    approvalId != null && approvalId === activeApprovalId;

  return {
    running,
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
  if (state.approvalRequested) return "yellow";
  if (state.running) return "yellow";
  if (state.error) return "red";
  return "green";
}

/**
 * Get the status label based on tool state.
 */
export function getStatusLabel(state: ToolRenderState): string | null {
  if (state.denied) {
    return state.denialReason ? `Denied: ${state.denialReason}` : "Denied";
  }
  if (state.approvalRequested) {
    return state.isActiveApproval ? "Running…" : "Waiting for approval…";
  }
  if (state.running) {
    return "Running…";
  }
  if (state.error) {
    return `Error: ${state.error.slice(0, 80)}`;
  }
  return null;
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
