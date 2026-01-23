import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { type LanguageModelUsage, type UIMessage, isToolUIPart } from "ai";
import { Chat } from "@ai-sdk/react";
import { createAgentTransport } from "./transport";
import { tuiAgent } from "./config";
import type {
  TUIAgentCallOptions,
  TUIAgentUIMessage,
  PermissionMode,
  ApprovalRule,
} from "./types";
import type { Settings } from "./lib/settings";
import { AVAILABLE_MODELS, type ModelInfo } from "./lib/models";
import { getContextLimit } from "@open-harness/agent";
import { generatePlanName } from "@open-harness/shared";
import type { Sandbox } from "@open-harness/sandbox";
import { join } from "node:path";

export type PanelState =
  | { type: "none" }
  | { type: "model-select" }
  | { type: "resume" };

type ChatState = {
  model?: string;
  permissionMode: PermissionMode;
  workingDirectory?: string;
  usage: LanguageModelUsage;
  sessionUsage: LanguageModelUsage;
  contextLimit: number;
  approvalRules: ApprovalRule[];
  settings: Settings;
  activePanel: PanelState;
  availableModels: ModelInfo[];
  sessionId: string | null;
  projectPath: string | null;
  currentBranch: string;
  planFilePath: string | null;
};

type ChatContextValue = {
  chat: Chat<TUIAgentUIMessage>;
  state: ChatState;
  setPermissionMode: (mode: PermissionMode, planFilePath?: string) => void;
  cyclePermissionMode: () => void;
  addApprovalRule: (rule: ApprovalRule) => void;
  clearApprovalRules: () => void;
  updateSettings: (updates: Partial<Settings>) => void;
  openPanel: (panel: PanelState) => void;
  closePanel: () => void;
  setSessionId: (sessionId: string | null) => void;
  resetUsage: () => void;
};

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

const PERMISSION_MODES: PermissionMode[] = ["default", "edits", "plan"];

/**
 * Custom predicate that handles both approval-based tools and client-side tools.
 *
 * This is a combination of the library's two predicates:
 * - lastAssistantMessageIsCompleteWithToolCalls (requires output-available/output-error)
 * - lastAssistantMessageIsCompleteWithApprovalResponses (also allows approval-responded)
 *
 * Returns true when all tools in the last step are in a terminal state:
 * - output-available: execution complete
 * - output-error: execution failed
 * - approval-responded: approval given/denied (server will execute next)
 */
function shouldAutoSubmit({ messages }: { messages: UIMessage[] }): boolean {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== "assistant") return false;

  // Find the last step boundary (for multi-step agents)
  const lastStepStartIndex = lastMessage.parts.reduce(
    (lastIndex, part, index) =>
      part.type === "step-start" ? index : lastIndex,
    -1,
  );

  // Get tool invocations from the last step, excluding provider-executed tools
  const lastStepToolInvocations = lastMessage.parts
    .slice(lastStepStartIndex + 1)
    .filter(isToolUIPart)
    .filter((part) => !part.providerExecuted);

  // Need at least one tool call
  if (lastStepToolInvocations.length === 0) return false;

  // All tools must be in a terminal state
  return lastStepToolInvocations.every(
    (part) =>
      part.state === "output-available" ||
      part.state === "output-error" ||
      part.state === "approval-responded",
  );
}

type ChatProviderProps = {
  children: ReactNode;
  agentOptions: TUIAgentCallOptions;
  model?: string;
  workingDirectory?: string;
  initialPermissionMode?: PermissionMode;
  initialSettings?: Settings;
  onSettingsChange?: (settings: Settings) => void;
  availableModels?: ModelInfo[];
  projectPath?: string;
  currentBranch?: string;
  initialSessionId?: string;
  initialMessages?: TUIAgentUIMessage[];
  /** Sandbox for plan file creation (used when cycling permission mode manually) */
  sandbox?: Sandbox;
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
  initialPermissionMode = "default",
  initialSettings = {},
  onSettingsChange,
  availableModels = AVAILABLE_MODELS,
  projectPath,
  currentBranch = "",
  initialSessionId,
  initialMessages,
  sandbox,
}: ChatProviderProps) {
  const [permissionMode, setPermissionModeState] = useState<PermissionMode>(
    initialPermissionMode,
  );
  const [usage, setUsage] = useState<LanguageModelUsage>(DEFAULT_USAGE);
  const [sessionUsage, setSessionUsage] =
    useState<LanguageModelUsage>(DEFAULT_USAGE);
  const [approvalRules, setApprovalRules] = useState<ApprovalRule[]>([]);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [activePanel, setActivePanel] = useState<PanelState>({ type: "none" });
  const [sessionId, setSessionId] = useState<string | null>(
    initialSessionId ?? null,
  );
  const [planFilePath, setPlanFilePath] = useState<string | null>(null);

  // Use refs to pass current values to transport without recreating it
  const permissionModeRef = useRef(permissionMode);
  permissionModeRef.current = permissionMode;
  const approvalRulesRef = useRef(approvalRules);
  approvalRulesRef.current = approvalRules;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const currentBranchRef = useRef(currentBranch);
  currentBranchRef.current = currentBranch;
  const planFilePathRef = useRef(planFilePath);
  planFilePathRef.current = planFilePath;

  // Use ref for initialMessages to avoid recreating chat when it changes
  const initialMessagesRef = useRef(initialMessages);
  // Only set on first render - don't update on subsequent renders
  if (
    initialMessagesRef.current === undefined &&
    initialMessages !== undefined
  ) {
    initialMessagesRef.current = initialMessages;
  }

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

  // Set permission mode directly (for agent-triggered changes)
  const setPermissionMode = useCallback(
    (mode: PermissionMode, filePath?: string) => {
      setPermissionModeState(mode);
      setPlanFilePath(filePath ?? null);
    },
    [],
  );

  const transport = useMemo(
    () =>
      createAgentTransport({
        agent: tuiAgent,
        agentOptions,
        getPermissionMode: () => permissionModeRef.current,
        getApprovalRules: () => approvalRulesRef.current,
        getSettings: () => settingsRef.current,
        getPlanFilePath: () => planFilePathRef.current,
        onUsageUpdate: handleUsageUpdate,
        onPermissionModeChange: setPermissionMode,
        persistence: projectPath
          ? {
              getSessionId: () => sessionIdRef.current,
              projectPath,
              getBranch: () => currentBranchRef.current,
              onSessionCreated: setSessionId,
            }
          : undefined,
      }),
    [agentOptions, handleUsageUpdate, projectPath, setPermissionMode],
  );

  const chat = useMemo(
    () =>
      new Chat<TUIAgentUIMessage>({
        transport,
        sendAutomaticallyWhen: shouldAutoSubmit,
        messages: initialMessagesRef.current,
      }),
    [transport],
  );

  const state: ChatState = useMemo(
    () => ({
      model: effectiveModel,
      permissionMode,
      workingDirectory,
      usage,
      sessionUsage,
      contextLimit,
      approvalRules,
      settings,
      activePanel,
      availableModels,
      sessionId,
      projectPath: projectPath ?? null,
      currentBranch,
      planFilePath,
    }),
    [
      effectiveModel,
      permissionMode,
      workingDirectory,
      usage,
      sessionUsage,
      contextLimit,
      approvalRules,
      settings,
      activePanel,
      availableModels,
      sessionId,
      projectPath,
      currentBranch,
      planFilePath,
    ],
  );

  const cyclePermissionMode = useCallback(() => {
    const prev = permissionModeRef.current;
    const currentIndex = PERMISSION_MODES.indexOf(prev);
    const nextIndex = (currentIndex + 1) % PERMISSION_MODES.length;
    const nextMode = PERMISSION_MODES[nextIndex] ?? "default";

    // Update mode ref and state IMMEDIATELY (before any async work)
    // This ensures the transport sees the new mode even if user sends a message right away
    permissionModeRef.current = nextMode;
    setPermissionModeState(nextMode);

    // If entering plan mode, create plan file using sandbox
    if (nextMode === "plan" && sandbox) {
      const planName = generatePlanName();
      const plansDir = join(sandbox.workingDirectory, ".open-harness", "plans");
      const newPlanFilePath = join(plansDir, `${planName}.md`);

      // Update planFilePath ref and state IMMEDIATELY (before mkdir)
      planFilePathRef.current = newPlanFilePath;
      setPlanFilePath(newPlanFilePath);

      // Fire-and-forget: create directory in background
      // The mode is already set; this just ensures the dir exists before agent writes
      sandbox.mkdir(plansDir, { recursive: true }).catch(() => {
        // Ignore errors - will be caught when agent tries to write
      });
    } else if (prev === "plan") {
      // Exiting plan mode, clear plan file path
      planFilePathRef.current = null;
      setPlanFilePath(null);
    }
  }, [sandbox]);

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

  const resetUsage = useCallback(() => {
    setUsage(DEFAULT_USAGE);
    setSessionUsage(DEFAULT_USAGE);
  }, []);

  return (
    <ChatContext.Provider
      value={{
        chat,
        state,
        setPermissionMode,
        cyclePermissionMode,
        addApprovalRule,
        clearApprovalRules,
        updateSettings,
        openPanel,
        closePanel,
        setSessionId,
        resetUsage,
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
