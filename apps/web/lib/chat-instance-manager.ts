import { Chat } from "@ai-sdk/react";
import type { WebAgentUIMessage } from "@/app/types";

type ChatInstanceInit = ConstructorParameters<
  typeof Chat<WebAgentUIMessage>
>[0];

const chatInstances = new Map<string, Chat<WebAgentUIMessage>>();

export function getOrCreateChatInstance(
  chatId: string,
  init: ChatInstanceInit,
): { instance: Chat<WebAgentUIMessage>; alreadyExisted: boolean } {
  const existing = chatInstances.get(chatId);
  if (existing) return { instance: existing, alreadyExisted: true };
  const instance = new Chat<WebAgentUIMessage>(init);
  chatInstances.set(chatId, instance);
  return { instance, alreadyExisted: false };
}

export function removeChatInstance(chatId: string): void {
  chatInstances.delete(chatId);
}
