import { isReasoningUIPart, isToolUIPart } from "ai";
import type { WebAgentUIMessagePart } from "@/app/types";

export type ChatUiStatus = "submitted" | "streaming" | "ready" | "error";

export function isChatInFlight(status: ChatUiStatus): boolean {
  return status === "submitted" || status === "streaming";
}

export function hasRenderableAssistantPart(
  part: WebAgentUIMessagePart,
): boolean {
  if (part.type === "text") {
    return part.text.length > 0;
  }

  if (isToolUIPart(part)) {
    return true;
  }

  if (isReasoningUIPart(part)) {
    return part.text.length > 0 || part.state === "streaming";
  }

  return false;
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

export function shouldKeepCollapsedReasoningStreaming(options: {
  isMessageStreaming: boolean;
  hasStreamingReasoningPart: boolean;
  hasRenderableContentAfterGroup: boolean;
}): boolean {
  const {
    isMessageStreaming,
    hasStreamingReasoningPart,
    hasRenderableContentAfterGroup,
  } = options;

  if (!isMessageStreaming) {
    return false;
  }

  if (hasStreamingReasoningPart) {
    return true;
  }

  return !hasRenderableContentAfterGroup;
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
