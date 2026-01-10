"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  DefaultChatTransport,
} from "ai";
import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import type { WebAgentUIMessage } from "./types";

type ChatState = {
  model?: string;
  workingDirectory?: string;
};

type ChatContextValue = {
  chat: UseChatHelpers<WebAgentUIMessage>;
  state: ChatState;
};

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

type ChatProviderProps = {
  children: ReactNode;
  model?: string;
  workingDirectory?: string;
  apiEndpoint?: string;
};

export function ChatProvider({
  children,
  model,
  workingDirectory,
  apiEndpoint = "/api/chat",
}: ChatProviderProps) {
  const transport = useMemo(
    () => new DefaultChatTransport({ api: apiEndpoint }),
    [apiEndpoint],
  );

  const chat = useChat<WebAgentUIMessage>({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  const state: ChatState = useMemo(
    () => ({
      model,
      workingDirectory,
    }),
    [model, workingDirectory],
  );

  return (
    <ChatContext.Provider value={{ chat, state }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return context;
}
