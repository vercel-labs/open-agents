import type { SharedChatStatusData } from "@/app/shared/[shareId]/shared-chat-status-utils";
import { getChatById, getChatMessages } from "@/lib/db/sessions";
import { getShareByIdCached } from "@/lib/db/sessions-cache";

/**
 * Resolve a shareId to a minimal public status payload.
 * Returns `null` when the share or underlying chat cannot be found.
 */
export async function getSharedChatStatus(
  shareId: string,
): Promise<SharedChatStatusData | null> {
  const share = await getShareByIdCached(shareId);
  if (!share) return null;

  const chat = await getChatById(share.chatId);
  if (!chat) return null;

  const isStreaming = chat.activeStreamId != null;

  let startedAt: string | null = null;
  if (isStreaming) {
    const messages = await getChatMessages(chat.id);
    const lastUserMessage = messages
      .toReversed()
      .find((m) => m.role === "user");
    startedAt = lastUserMessage
      ? lastUserMessage.createdAt.toISOString()
      : null;
  }

  return { isStreaming, startedAt };
}
