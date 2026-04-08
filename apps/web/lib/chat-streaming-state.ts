import { isReasoningUIPart, isToolUIPart } from "ai";
import type {
  WebAgentCommitDataPart,
  WebAgentPrDataPart,
  WebAgentUIMessagePart,
} from "@/app/types";

export type ChatUiStatus = "submitted" | "streaming" | "ready" | "error";

export function isChatInFlight(status: ChatUiStatus): boolean {
  return status === "submitted" || status === "streaming";
}

export function isGitDataPart(
  part: WebAgentUIMessagePart,
): part is WebAgentCommitDataPart | WebAgentPrDataPart {
  return part.type === "data-commit" || part.type === "data-pr";
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

  if (isGitDataPart(part)) {
    return true;
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

export function getGitFinalizationState(options: {
  status: ChatUiStatus;
  lastMessageRole: "assistant" | "user" | "system" | undefined;
  lastMessageParts: WebAgentUIMessagePart[] | undefined;
}): {
  isFinalizing: boolean;
  label: string | null;
} {
  const { status, lastMessageRole, lastMessageParts } = options;

  if (
    !isChatInFlight(status) ||
    lastMessageRole !== "assistant" ||
    !lastMessageParts
  ) {
    return { isFinalizing: false, label: null };
  }

  const gitParts = lastMessageParts.filter(isGitDataPart);
  if (gitParts.length === 0) {
    return { isFinalizing: false, label: null };
  }

  if (
    gitParts.some(
      (part) => part.type === "data-pr" && part.data.status === "pending",
    )
  ) {
    return { isFinalizing: true, label: "Creating pull request…" };
  }

  if (
    gitParts.some(
      (part) => part.type === "data-commit" && part.data.status === "pending",
    )
  ) {
    return { isFinalizing: true, label: "Creating commit…" };
  }

  return { isFinalizing: true, label: "Finalizing git actions…" };
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
