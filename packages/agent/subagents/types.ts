import type { InferAgentUIMessage, LanguageModelUsage } from "ai";
import type { createExecutorSubagent } from "./executor";
import type { createExplorerSubagent } from "./explorer";

export type SubagentMessageMetadata = {
  lastStepUsage?: LanguageModelUsage;
  totalMessageUsage?: LanguageModelUsage;
  modelId?: string;
};

export type SubagentUIMessage =
  | InferAgentUIMessage<
      ReturnType<typeof createExplorerSubagent>,
      SubagentMessageMetadata
    >
  | InferAgentUIMessage<
      ReturnType<typeof createExecutorSubagent>,
      SubagentMessageMetadata
    >;
