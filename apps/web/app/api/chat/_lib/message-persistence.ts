import type { WebAgentUIMessage } from "@/app/types";
import {
  createChatMessageIfNotExists,
  isFirstChatMessage,
  touchChat,
  updateChat,
} from "@/lib/db/sessions";

async function persistLatestUserMessage(
  chatId: string,
  latestMessage: WebAgentUIMessage,
): Promise<void> {
  if (latestMessage.role !== "user") {
    return;
  }

  try {
    const createdUserMessage = await createChatMessageIfNotExists({
      id: latestMessage.id,
      chatId,
      role: "user",
      parts: latestMessage,
    });

    if (!createdUserMessage) {
      return;
    }

    await touchChat(chatId);

    const shouldSetTitle = await isFirstChatMessage(
      chatId,
      createdUserMessage.id,
    );
    if (!shouldSetTitle) {
      return;
    }

    const textContent = latestMessage.parts
      .filter(
        (part): part is { type: "text"; text: string } => part.type === "text",
      )
      .map((part) => part.text)
      .join(" ")
      .trim();

    if (textContent.length === 0) {
      return;
    }

    const title =
      textContent.length > 30 ? `${textContent.slice(0, 30)}...` : textContent;
    await updateChat(chatId, { title });
  } catch (error) {
    console.error("Failed to save latest chat message:", error);
  }
}

export function scheduleLatestMessagePersistence(
  chatId: string,
  messages: WebAgentUIMessage[],
): WebAgentUIMessage | null {
  const latestMessage = messages[messages.length - 1];
  if (
    !latestMessage ||
    (latestMessage.role !== "user" && latestMessage.role !== "assistant") ||
    typeof latestMessage.id !== "string" ||
    latestMessage.id.length === 0
  ) {
    return null;
  }

  if (latestMessage.role === "assistant") {
    return latestMessage;
  }

  void persistLatestUserMessage(chatId, latestMessage);
  return null;
}
