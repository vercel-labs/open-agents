export type ChatUiStatus = "submitted" | "streaming" | "ready" | "error";

export function isChatInFlight(status: ChatUiStatus): boolean {
  return status === "submitted" || status === "streaming";
}

export function shouldShowThinkingIndicator(options: {
  status: ChatUiStatus;
  hasAssistantRenderableContent: boolean;
  lastMessageRole: "assistant" | "user" | "system" | undefined;
}): boolean {
  const { status, hasAssistantRenderableContent, lastMessageRole } = options;
  if (!isChatInFlight(status)) {
    return false;
  }

  if (lastMessageRole !== "assistant") {
    return true;
  }

  return !hasAssistantRenderableContent;
}

export function shouldRefreshAfterReadyTransition(options: {
  prevStatus: ChatUiStatus | null;
  status: ChatUiStatus;
  hasAssistantRenderableContent: boolean;
}): boolean {
  const { prevStatus, status, hasAssistantRenderableContent } = options;
  return (
    prevStatus === "submitted" &&
    status === "ready" &&
    hasAssistantRenderableContent
  );
}
