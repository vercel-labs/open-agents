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
import { createAgentTransport } from "./transport";
import { tuiAgent } from "./config";
import type {
  TUIAgentCallOptions,
  TUIAgentUIMessage,
  AutoAcceptMode,
  ApprovalRule,
} from "./types";
import type { Settings } from "./lib/settings";
import { AVAILABLE_MODELS, type ModelInfo } from "./lib/models";
import { getContextLimit } from "@open-harness/agent";

export type PanelState = { type: "none" } | { type: "model-select" };

type ChatState = {
  model?: string;
  autoAcceptMode: AutoAcceptMode;
  workingDirectory?: string;
  usage: LanguageModelUsage;
  sessionUsage: LanguageModelUsage;
  contextLimit: number;
  approvalRules: ApprovalRule[];
  settings: Settings;
  activePanel: PanelState;
  availableModels: ModelInfo[];
};

type ChatContextValue = {
  chat: Chat<TUIAgentUIMessage>;
  state: ChatState;
  setAutoAcceptMode: (mode: AutoAcceptMode) => void;
  cycleAutoAcceptMode: () => void;
  addApprovalRule: (rule: ApprovalRule) => void;
  clearApprovalRules: () => void;
  updateSettings: (updates: Partial<Settings>) => void;
  openPanel: (panel: PanelState) => void;
  closePanel: () => void;
};

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

const AUTO_ACCEPT_MODES: AutoAcceptMode[] = ["off", "edits", "all"];

type ChatProviderProps = {
  children: ReactNode;
  agentOptions: TUIAgentCallOptions;
  model?: string;
  workingDirectory?: string;
  initialAutoAcceptMode?: AutoAcceptMode;
  initialSettings?: Settings;
  onSettingsChange?: (settings: Settings) => void;
  availableModels?: ModelInfo[];
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
  initialAutoAcceptMode = "off",
  initialSettings = {},
  onSettingsChange,
  availableModels = AVAILABLE_MODELS,
}: ChatProviderProps) {
  const [autoAcceptMode, setAutoAcceptMode] = useState<AutoAcceptMode>(
    initialAutoAcceptMode,
  );
  const [usage, setUsage] = useState<LanguageModelUsage>(DEFAULT_USAGE);
  const [sessionUsage, setSessionUsage] =
    useState<LanguageModelUsage>(DEFAULT_USAGE);
  const [approvalRules, setApprovalRules] = useState<ApprovalRule[]>([]);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [activePanel, setActivePanel] = useState<PanelState>({ type: "none" });

  // Use refs to pass current values to transport without recreating it
  const autoAcceptModeRef = useRef(autoAcceptMode);
  autoAcceptModeRef.current = autoAcceptMode;
  const approvalRulesRef = useRef(approvalRules);
  approvalRulesRef.current = approvalRules;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const effectiveModel = settings.modelId ?? model ?? "";
  const contextLimit = useMemo(
    () => getContextLimit(effectiveModel),
    [effectiveModel],
  );

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
        getSettings: () => settingsRef.current,
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
      model: effectiveModel,
      autoAcceptMode,
      workingDirectory,
      usage,
      sessionUsage,
      contextLimit,
      approvalRules,
      settings,
      activePanel,
      availableModels,
    }),
    [
      effectiveModel,
      autoAcceptMode,
      workingDirectory,
      usage,
      sessionUsage,
      contextLimit,
      approvalRules,
      settings,
      activePanel,
      availableModels,
    ],
  );

  const cycleAutoAcceptMode = () => {
    setAutoAcceptMode((prev) => {
      const currentIndex = AUTO_ACCEPT_MODES.indexOf(prev);
      const nextIndex = (currentIndex + 1) % AUTO_ACCEPT_MODES.length;
      return AUTO_ACCEPT_MODES[nextIndex] ?? "off";
    });
  };

  const updateSettings = useCallback(
    (updates: Partial<Settings>) => {
      setSettings((prev) => {
        const newSettings = { ...prev, ...updates };
        onSettingsChange?.(newSettings);
        return newSettings;
      });
    },
    [onSettingsChange],
  );

  const openPanel = useCallback((panel: PanelState) => {
    setActivePanel(panel);
  }, []);

  const closePanel = useCallback(() => {
    setActivePanel({ type: "none" });
  }, []);

  return (
    <ChatContext.Provider
      value={{
        chat,
        state,
        setAutoAcceptMode,
        cycleAutoAcceptMode,
        addApprovalRule,
        clearApprovalRules,
        updateSettings,
        openPanel,
        closePanel,
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
