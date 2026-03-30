import type { InferAgentUIMessage, LanguageModelUsage } from "ai";
import type { designSubagent } from "./design";
import type { executorSubagent } from "./executor";
import type { explorerSubagent } from "./explorer";

export type SubagentMessageMetadata = {
  lastStepUsage?: LanguageModelUsage;
  totalMessageUsage?: LanguageModelUsage;
  modelId?: string;
};

// Union of all subagent types to support all tool types at runtime
export type SubagentUIMessage =
  | InferAgentUIMessage<typeof explorerSubagent, SubagentMessageMetadata>
  | InferAgentUIMessage<typeof executorSubagent, SubagentMessageMetadata>
  | InferAgentUIMessage<typeof designSubagent, SubagentMessageMetadata>;
