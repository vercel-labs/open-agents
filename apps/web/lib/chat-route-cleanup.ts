import {
  abortChatInstanceTransport,
  removeChatInstance,
} from "@/lib/chat-instance-manager";
import { clearChatWorkspaceStatus } from "@/lib/workspace-status-store";

type ChatRouteCleanupDependencies = {
  abortTransport: (chatId: string) => void;
  removeInstance: (chatId: string) => void;
  clearWorkspaceStatus?: (chatId: string) => void;
  stopStream?: (chatId: string) => void;
};

const defaultDependencies: ChatRouteCleanupDependencies = {
  abortTransport: abortChatInstanceTransport,
  removeInstance: removeChatInstance,
  clearWorkspaceStatus: clearChatWorkspaceStatus,
};

/**
 * Route teardown cleanup for chat pages.
 *
 * This intentionally does NOT issue a server stop signal; generation may still
 * continue in the background while the user is off-page.
 */
export function cleanupChatRouteOnUnmount(
  chatId: string,
  dependencies: ChatRouteCleanupDependencies = defaultDependencies,
): void {
  dependencies.abortTransport(chatId);
  dependencies.removeInstance(chatId);
  dependencies.clearWorkspaceStatus?.(chatId);
}
