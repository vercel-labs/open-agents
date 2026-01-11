"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  DefaultChatTransport,
} from "ai";
import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import type { WebAgentUIMessage } from "./types";

export type SandboxInfo = {
  sandboxId: string;
  createdAt: number;
  timeout: number;
  currentBranch?: string;
};

export type RepoInfo = {
  owner: string;
  repo: string;
  fullName: string;
  cloneUrl: string;
  branch: string;
};

const REPO_STORAGE_KEY = "open-harness-repo";

type ChatState = {
  model?: string;
  workingDirectory?: string;
};

type ChatContextValue = {
  chat: UseChatHelpers<WebAgentUIMessage>;
  state: ChatState;
  sandboxInfo: SandboxInfo | null;
  setSandboxInfo: (info: SandboxInfo) => void;
  clearSandboxInfo: () => void;
  repoInfo: RepoInfo | null;
  setRepoInfo: (info: RepoInfo) => void;
  clearRepoInfo: () => void;
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
  const sandboxIdRef = useRef<string | null>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: apiEndpoint,
        body: () => ({
          sandboxId: sandboxIdRef.current,
        }),
      }),
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

  const [sandboxInfo, setSandboxInfoState] = useState<SandboxInfo | null>(null);

  const setSandboxInfo = useCallback((info: SandboxInfo) => {
    sandboxIdRef.current = info.sandboxId;
    setSandboxInfoState(info);
  }, []);

  const clearSandboxInfo = useCallback(() => {
    sandboxIdRef.current = null;
    setSandboxInfoState(null);
  }, []);

  // Repo state with localStorage persistence
  const [repoInfo, setRepoInfoState] = useState<RepoInfo | null>(null);

  // Load repo from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(REPO_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as RepoInfo;
        setRepoInfoState(parsed);
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  const setRepoInfo = useCallback((info: RepoInfo) => {
    setRepoInfoState(info);
    try {
      localStorage.setItem(REPO_STORAGE_KEY, JSON.stringify(info));
    } catch {
      // Ignore storage errors
    }
  }, []);

  const clearRepoInfo = useCallback(() => {
    setRepoInfoState(null);
    try {
      localStorage.removeItem(REPO_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }, []);

  return (
    <ChatContext.Provider
      value={{
        chat,
        state,
        sandboxInfo,
        setSandboxInfo,
        clearSandboxInfo,
        repoInfo,
        setRepoInfo,
        clearRepoInfo,
      }}
    >
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
