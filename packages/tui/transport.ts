import {
  generateId,
  type ChatTransport,
  type LanguageModelUsage,
  convertToModelMessages,
  smoothStream,
  pruneMessages,
} from "ai";
import { defaultModelLabel } from "@open-harness/agent";
import type {
  TUIAgent,
  TUIAgentCallOptions,
  TUIAgentUIMessage,
  AutoAcceptMode,
  ApprovalRule,
} from "./types";
import type { Settings } from "./lib/settings";
import { getModelById, type GatewayFn } from "./lib/models";
import { createSession, saveSession } from "./lib/session-storage";

export type PersistenceConfig = {
  getSessionId: () => string | null;
  projectPath: string;
  getBranch: () => string;
  onSessionCreated: (id: string) => void;
};

export type AgentTransportOptions = {
  agent: TUIAgent;
  agentOptions: TUIAgentCallOptions;
  getAutoApprove?: () => AutoAcceptMode;
  getApprovalRules?: () => ApprovalRule[];
  getSettings?: () => Settings;
  onUsageUpdate?: (usage: LanguageModelUsage) => void;
  onBeforeRequest?: () => void;
  persistence?: PersistenceConfig;
  gateway?: GatewayFn;
};

export function createAgentTransport({
  agent,
  agentOptions,
  getAutoApprove,
  getApprovalRules,
  getSettings,
  onUsageUpdate,
  onBeforeRequest,
  persistence,
  gateway,
}: AgentTransportOptions): ChatTransport<TUIAgentUIMessage> {
  return {
    sendMessages: async ({ messages, abortSignal }) => {
      // Promote pending approval rules before building request
      onBeforeRequest?.();
      // Pass the agent's tools so convertToModelMessages can properly handle
      // tool approval responses for locally-executed tools
      const modelMessages = await convertToModelMessages(messages, {
        tools: agent.tools,
        ignoreIncompleteToolCalls: true,
      });

      // Prune incomplete messages from aborted requests
      const prunedMessages = pruneMessages({
        messages: modelMessages,
        emptyMessages: "remove",
      });

      // Get current settings at request time and build approval config
      const autoApprove = getAutoApprove ? getAutoApprove() : "off";
      const sessionRules = getApprovalRules ? getApprovalRules() : [];
      const settings = getSettings?.() ?? {};
      const modelId = settings.modelId ?? defaultModelLabel;
      const model = getModelById(modelId, { devtools: true, gateway });

      // Build the approval config based on the current base config type
      const baseApproval = agentOptions.approval;
      let approval: typeof baseApproval;
      switch (baseApproval.type) {
        case "interactive":
          // Interactive mode: inject current UI settings
          approval = {
            type: "interactive",
            autoApprove,
            sessionRules,
          };
          break;
        case "background":
        case "delegated":
          // These modes are fully trusted - pass through unchanged
          approval = baseApproval;
          break;
      }

      const result = await agent.stream({
        messages: prunedMessages,
        options: { ...agentOptions, ...(model && { model }), approval },
        abortSignal: abortSignal ?? undefined,
        experimental_transform: smoothStream({ chunking: "line" }),
      });

      // Capture usage after stream completes (non-blocking)
      // Use per-call usage (last step) for accurate context % display
      Promise.resolve(result.usage)
        .then((usage) => {
          onUsageUpdate?.(usage);
        })
        .catch(() => {
          // Ignore errors from aborted requests
        });

      // Track session ID locally so we can update it after creation
      let currentSessionId = persistence?.getSessionId() ?? null;
      // Track last step usage for message metadata
      let lastStepUsage: LanguageModelUsage | undefined;

      return result.toUIMessageStream<TUIAgentUIMessage>({
        originalMessages: messages,
        generateMessageId: generateId,
        messageMetadata: ({ part }) => {
          // Track per-step usage from finish-step events. The last step's input
          // tokens represents actual context window utilization.
          if (part.type === "finish-step") {
            lastStepUsage = part.usage;
            return { lastStepUsage, totalMessageUsage: undefined };
          }
          // On finish, include both the last step usage and total message usage
          if (part.type === "finish") {
            return { lastStepUsage, totalMessageUsage: part.totalUsage };
          }
        },
        onFinish: async ({ messages: allMessages }) => {
          if (!persistence) return;

          try {
            // Get current branch at save time
            const branch = persistence.getBranch();

            // Create session if needed
            if (!currentSessionId) {
              currentSessionId = await createSession(
                persistence.projectPath,
                branch,
              );
              persistence.onSessionCreated(currentSessionId);
            }

            // Save all messages (overwrites file)
            await saveSession(
              persistence.projectPath,
              currentSessionId,
              branch,
              allMessages,
            );
          } catch {
            // Ignore persistence errors
          }
        },
      });
    },

    reconnectToStream: async () => {
      // Not supported for local agent calls
      return null;
    },
  };
}
