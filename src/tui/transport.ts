import {
  type ChatTransport,
  type LanguageModelUsage,
  convertToModelMessages,
  smoothStream,
  pruneMessages,
} from "ai";
import type {
  TUIAgent,
  TUIAgentCallOptions,
  TUIAgentUIMessage,
  AutoAcceptMode,
  ApprovalRule,
} from "./types";

export type AgentTransportOptions = {
  agent: TUIAgent;
  agentOptions: TUIAgentCallOptions;
  getAutoApprove?: () => AutoAcceptMode;
  getApprovalRules?: () => ApprovalRule[];
  onUsageUpdate?: (usage: LanguageModelUsage) => void;
};

export function createAgentTransport({
  agent,
  agentOptions,
  getAutoApprove,
  getApprovalRules,
  onUsageUpdate,
}: AgentTransportOptions): ChatTransport<TUIAgentUIMessage> {
  return {
    sendMessages: async ({ messages, abortSignal }) => {
      // Pass the agent's tools so convertToModelMessages can properly handle
      // tool approval responses for locally-executed tools
      const modelMessages = await convertToModelMessages(messages, {
        tools: agent.tools,
      });

      // Prune incomplete messages from aborted requests
      const prunedMessages = pruneMessages({
        messages: modelMessages,
        emptyMessages: "remove",
      });

      // Get current settings at request time
      const autoApprove = getAutoApprove?.() ?? "off";
      const approvalRules = getApprovalRules?.() ?? [];

      const result = await agent.stream({
        messages: prunedMessages,
        options: { ...agentOptions, autoApprove, approvalRules },
        abortSignal: abortSignal ?? undefined,
        experimental_transform: smoothStream(),
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

      return result.toUIMessageStream<TUIAgentUIMessage>({
        messageMetadata: ({ part }) => {
          if (part.type === "finish") {
            return { usage: part.totalUsage };
          }
          if (part.type === "finish-step") {
            return { usage: part.usage };
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
