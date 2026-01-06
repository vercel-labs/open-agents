import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import {
  type LanguageModelUsage,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { Chat } from "@ai-sdk/react";
import { createAgentTransport } from "./transport.js";
import { tuiAgent } from "./config.js";
import type {
  TUIAgentCallOptions,
  TUIAgentUIMessage,
  AutoAcceptMode,
  ApprovalRule,
} from "./types.js";
import { getContextLimit } from "../agent/utils/model-context-limits.js";

type ChatState = {
  model?: string;
  autoAcceptMode: AutoAcceptMode;
  workingDirectory?: string;
  usage: LanguageModelUsage;
  sessionUsage: LanguageModelUsage;
  contextLimit: number;
  approvalRules: ApprovalRule[];
};

type ChatContextValue = {
  chat: Chat<TUIAgentUIMessage>;
  state: ChatState;
  setAutoAcceptMode: (mode: AutoAcceptMode) => void;
  cycleAutoAcceptMode: () => void;
  addApprovalRule: (rule: ApprovalRule) => void;
  clearApprovalRules: () => void;
};

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

const AUTO_ACCEPT_MODES: AutoAcceptMode[] = ["off", "edits", "all"];

type ChatProviderProps = {
  children: ReactNode;
  agentOptions: TUIAgentCallOptions;
  model?: string;
  workingDirectory?: string;
};

const DEFAULT_USAGE: LanguageModelUsage = {
  inputTokens: undefined,
  outputTokens: undefined,
  totalTokens: undefined,
  inputTokenDetails: {
    noCacheTokens: undefined,
    cacheReadTokens: undefined,
    cacheWriteTokens: undefined,
  },
  outputTokenDetails: {
    textTokens: undefined,
    reasoningTokens: undefined,
  },
};

function addTokens(a?: number, b?: number) {
  if (a === undefined && b === undefined) return undefined;
  return (a ?? 0) + (b ?? 0);
}

function accumulateUsage(
  prev: LanguageModelUsage,
  next: LanguageModelUsage,
): LanguageModelUsage {
  const prevIn = prev.inputTokenDetails ?? {};
  const nextIn = next.inputTokenDetails ?? {};
  const prevOut = prev.outputTokenDetails ?? {};
  const nextOut = next.outputTokenDetails ?? {};

  return {
    inputTokens: addTokens(prev.inputTokens, next.inputTokens),
    outputTokens: addTokens(prev.outputTokens, next.outputTokens),
    totalTokens: addTokens(prev.totalTokens, next.totalTokens),
    inputTokenDetails: {
      noCacheTokens: addTokens(prevIn.noCacheTokens, nextIn.noCacheTokens),
      cacheReadTokens: addTokens(
        prevIn.cacheReadTokens,
        nextIn.cacheReadTokens,
      ),
      cacheWriteTokens: addTokens(
        prevIn.cacheWriteTokens,
        nextIn.cacheWriteTokens,
      ),
    },
    outputTokenDetails: {
      textTokens: addTokens(prevOut.textTokens, nextOut.textTokens),
      reasoningTokens: addTokens(
        prevOut.reasoningTokens,
        nextOut.reasoningTokens,
      ),
    },
  };
}

export function ChatProvider({
  children,
  agentOptions,
  model,
  workingDirectory,
}: ChatProviderProps) {
  const [autoAcceptMode, setAutoAcceptMode] = useState<AutoAcceptMode>("off");
  const [usage, setUsage] = useState<LanguageModelUsage>(DEFAULT_USAGE);
  const [sessionUsage, setSessionUsage] =
    useState<LanguageModelUsage>(DEFAULT_USAGE);
  const [approvalRules, setApprovalRules] = useState<ApprovalRule[]>([]);

  // Use refs to pass current values to transport without recreating it
  const autoAcceptModeRef = useRef(autoAcceptMode);
  autoAcceptModeRef.current = autoAcceptMode;
  const approvalRulesRef = useRef(approvalRules);
  approvalRulesRef.current = approvalRules;

  const contextLimit = useMemo(() => getContextLimit(model ?? ""), [model]);

  const handleUsageUpdate = useCallback((newUsage: LanguageModelUsage) => {
    setUsage(newUsage);
    setSessionUsage((prev) => accumulateUsage(prev, newUsage));
  }, []);

  const addApprovalRule = useCallback((rule: ApprovalRule) => {
    setApprovalRules((prev) => {
      // Avoid duplicates - check if an identical rule already exists
      const exists = prev.some(
        (r) => JSON.stringify(r) === JSON.stringify(rule),
      );
      if (exists) return prev;
      return [...prev, rule];
    });
  }, []);

  const clearApprovalRules = useCallback(() => {
    setApprovalRules([]);
  }, []);

  const transport = useMemo(
    () =>
      createAgentTransport({
        agent: tuiAgent,
        agentOptions,
        getAutoApprove: () => autoAcceptModeRef.current,
        getApprovalRules: () => approvalRulesRef.current,
        onUsageUpdate: handleUsageUpdate,
      }),
    [agentOptions, handleUsageUpdate],
  );

  const chat = useMemo(
    () =>
      new Chat<TUIAgentUIMessage>({
        transport,
        sendAutomaticallyWhen:
          lastAssistantMessageIsCompleteWithApprovalResponses,
      }),
    [transport],
  );

  const state: ChatState = useMemo(
    () => ({
      model,
      autoAcceptMode,
      workingDirectory,
      usage,
      sessionUsage,
      contextLimit,
      approvalRules,
    }),
    [
      model,
      autoAcceptMode,
      workingDirectory,
      usage,
      sessionUsage,
      contextLimit,
      approvalRules,
    ],
  );

  const cycleAutoAcceptMode = () => {
    setAutoAcceptMode((prev) => {
      const currentIndex = AUTO_ACCEPT_MODES.indexOf(prev);
      const nextIndex = (currentIndex + 1) % AUTO_ACCEPT_MODES.length;
      return AUTO_ACCEPT_MODES[nextIndex] ?? "off";
    });
  };

  return (
    <ChatContext.Provider
      value={{
        chat,
        state,
        setAutoAcceptMode,
        cycleAutoAcceptMode,
        addApprovalRule,
        clearApprovalRules,
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
