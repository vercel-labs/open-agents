import { isReasoningUIPart, isToolUIPart } from "ai";
import type {
  WebAgentCommitDataPart,
  WebAgentPrDataPart,
  WebAgentUIMessage,
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

export function shouldRenderGitDataPart(
  part: WebAgentCommitDataPart | WebAgentPrDataPart,
): boolean {
  if (part.type === "data-commit" && part.data.status === "skipped") {
    return false;
  }

  return true;
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
    return shouldRenderGitDataPart(part);
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

export function shouldUseChatListStreamingState(options: {
  status: ChatUiStatus;
  hasChatListStreaming: boolean;
  userStopped: boolean;
  hasAssistantRenderableContent: boolean;
  lastMessageRole: "assistant" | "user" | "system" | undefined;
}): boolean {
  const {
    status,
    hasChatListStreaming,
    userStopped,
    hasAssistantRenderableContent,
    lastMessageRole,
  } = options;

  if (userStopped || isChatInFlight(status) || !hasChatListStreaming) {
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

function getPendingGitActionLabel(action: "commit" | "pr"): string {
  return action === "pr" ? "Creating pull request…" : "Creating commit…";
}

function getLatestAssistantGitMessage(messages: WebAgentUIMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "assistant") {
      continue;
    }

    if (message.parts.some(isGitDataPart)) {
      return message;
    }
  }

  return null;
}

export function getNavbarGitActionState(messages: WebAgentUIMessage[]): {
  pendingAction: "commit" | "pr" | null;
  label: string | null;
  latestCommitPart: WebAgentCommitDataPart | null;
  latestPrPart: WebAgentPrDataPart | null;
} {
  const latestGitMessage = getLatestAssistantGitMessage(messages);

  if (!latestGitMessage) {
    return {
      pendingAction: null,
      label: null,
      latestCommitPart: null,
      latestPrPart: null,
    };
  }

  let latestCommitPart: WebAgentCommitDataPart | null = null;
  let latestPrPart: WebAgentPrDataPart | null = null;
  let pendingAction: "commit" | "pr" | null = null;

  for (let i = latestGitMessage.parts.length - 1; i >= 0; i--) {
    const part = latestGitMessage.parts[i];

    if (part.type === "data-commit") {
      latestCommitPart ??= part;
      if (pendingAction === null && part.data.status === "pending") {
        pendingAction = "commit";
      }
      continue;
    }

    if (part.type === "data-pr") {
      latestPrPart ??= part;
      if (pendingAction === null && part.data.status === "pending") {
        pendingAction = "pr";
      }
    }
  }

  return {
    pendingAction,
    label: pendingAction ? getPendingGitActionLabel(pendingAction) : null,
    latestCommitPart,
    latestPrPart,
  };
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
    return { isFinalizing: true, label: getPendingGitActionLabel("pr") };
  }

  if (
    gitParts.some(
      (part) => part.type === "data-commit" && part.data.status === "pending",
    )
  ) {
    return { isFinalizing: true, label: getPendingGitActionLabel("commit") };
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
