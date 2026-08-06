import type { WebAgentWorkspaceStatusData } from "@/app/types";

type WorkspaceStatusListener = () => void;

const workspaceStatuses = new Map<string, WebAgentWorkspaceStatusData>();
const workspaceStatusListeners = new Map<
  string,
  Set<WorkspaceStatusListener>
>();

function notifyWorkspaceStatusListeners(chatId: string): void {
  const listeners = workspaceStatusListeners.get(chatId);
  if (!listeners) {
    return;
  }

  for (const listener of listeners) {
    listener();
  }
}

export function setChatWorkspaceStatus(
  chatId: string,
  status: WebAgentWorkspaceStatusData,
): void {
  workspaceStatuses.set(chatId, status);
  notifyWorkspaceStatusListeners(chatId);
}

export function clearChatWorkspaceStatus(chatId: string): void {
  const hadStatus = workspaceStatuses.delete(chatId);
  if (hadStatus) {
    notifyWorkspaceStatusListeners(chatId);
  }
}

export function getChatWorkspaceStatusSnapshot(
  chatId: string,
): WebAgentWorkspaceStatusData | null {
  return workspaceStatuses.get(chatId) ?? null;
}

export function subscribeChatWorkspaceStatus(
  chatId: string,
  listener: WorkspaceStatusListener,
): () => void {
  const existingListeners = workspaceStatusListeners.get(chatId);
  const listeners = existingListeners ?? new Set<WorkspaceStatusListener>();

  if (!existingListeners) {
    workspaceStatusListeners.set(chatId, listeners);
  }

  listeners.add(listener);

  return () => {
    const currentListeners = workspaceStatusListeners.get(chatId);
    if (!currentListeners) {
      return;
    }

    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      workspaceStatusListeners.delete(chatId);
    }
  };
}
