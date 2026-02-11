import {
  collectTaskToolUsageEvents,
  defaultModelLabel,
  type GatewayConfig,
  sumLanguageModelUsage,
} from "@open-harness/agent";
import {
  type ChatTransport,
  convertToModelMessages,
  generateId,
  type LanguageModelUsage,
  pruneMessages,
  smoothStream,
} from "ai";
import { getModelById } from "./lib/models";
import { createSession, saveSession } from "./lib/session-storage";
import type { Settings } from "./lib/settings";
import type {
  ApprovalRule,
  AutoAcceptMode,
  TUIAgent,
  TUIAgentCallOptions,
  TUIAgentUIMessage,
} from "./types";

const cachedInputTokensFor = (usage: LanguageModelUsage) =>
  usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? 0;

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
  gatewayConfig?: GatewayConfig;
  devtools?: boolean;
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
  gatewayConfig,
  devtools = false,
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
      const model = getModelById(modelId, { devtools, gatewayConfig });

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
      let totalMessageUsage: LanguageModelUsage | undefined;

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
            totalMessageUsage = part.totalUsage;
            return { lastStepUsage, totalMessageUsage: part.totalUsage };
          }
        },
        onFinish: async ({ messages: allMessages }) => {
          if (persistence) {
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
          }

          // Report usage to web app when connected via gateway
          if (!gatewayConfig) {
            return;
          }

          const lastAssistantMessage = allMessages
            .filter((m) => m.role === "assistant")
            .at(-1);
          const baseUrl = gatewayConfig.baseURL.replace(/\/api\/ai-proxy$/, "");
          const postUsage = (
            usage: LanguageModelUsage,
            usageModelId: string,
            agentType: "main" | "subagent",
            messages: TUIAgentUIMessage[] = [],
          ) => {
            void fetch(`${baseUrl}/api/usage`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${gatewayConfig.apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                messages,
                usage: {
                  inputTokens: usage.inputTokens ?? 0,
                  cachedInputTokens: cachedInputTokensFor(usage),
                  outputTokens: usage.outputTokens ?? 0,
                },
                modelId: usageModelId,
                agentType,
              }),
            }).catch(() => {});
          };

          if (totalMessageUsage) {
            postUsage(
              totalMessageUsage,
              modelId,
              "main",
              lastAssistantMessage ? [lastAssistantMessage] : [],
            );
          }

          if (!lastAssistantMessage) {
            return;
          }

          const subagentUsageEvents =
            collectTaskToolUsageEvents(lastAssistantMessage);
          if (subagentUsageEvents.length === 0) {
            return;
          }
          const subagentUsageByModel = new Map<string, LanguageModelUsage>();
          for (const event of subagentUsageEvents) {
            const eventModelId = event.modelId ?? modelId;
            const existing = subagentUsageByModel.get(eventModelId);
            const combined = sumLanguageModelUsage(existing, event.usage);
            if (combined) {
              subagentUsageByModel.set(eventModelId, combined);
            }
          }

          for (const [eventModelId, usage] of subagentUsageByModel) {
            postUsage(usage, eventModelId, "subagent");
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
