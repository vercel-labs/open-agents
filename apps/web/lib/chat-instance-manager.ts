import { Chat } from "@ai-sdk/react";
import type { WebAgentUIMessage } from "@/app/types";

type ChatInstanceInit = ConstructorParameters<
  typeof Chat<WebAgentUIMessage>
>[0];

type ManagedChatInstance = {
  instance: Chat<WebAgentUIMessage>;
  transport: ChatInstanceInit["transport"];
};

type AbortableTransport = {
  abort: () => void;
};

function isAbortableTransport(value: unknown): value is AbortableTransport {
  return (
    typeof value === "object" &&
    value !== null &&
    "abort" in value &&
    typeof value.abort === "function"
  );
}

// Instances are scoped to an active chat route and removed on route teardown.
// This avoids accumulating background streams/message buffers when users switch
// between multiple chats quickly.
const chatInstances = new Map<string, ManagedChatInstance>();

export function getOrCreateChatInstance(
  chatId: string,
  init: ChatInstanceInit,
): {
  instance: Chat<WebAgentUIMessage>;
  alreadyExisted: boolean;
} {
  const existing = chatInstances.get(chatId);
  if (existing) {
    return {
      instance: existing.instance,
      alreadyExisted: true,
    };
  }

  const instance = new Chat<WebAgentUIMessage>(init);
  const managed = {
    instance,
    transport: init.transport,
  };
  chatInstances.set(chatId, managed);

  return {
    instance,
    alreadyExisted: false,
  };
}

export function abortChatInstanceTransport(chatId: string): void {
  const managed = chatInstances.get(chatId);
  if (!managed || !isAbortableTransport(managed.transport)) {
    return;
  }

  managed.transport.abort();
}

export function removeChatInstance(chatId: string): void {
  chatInstances.delete(chatId);
}
