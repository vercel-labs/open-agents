import type {
  DynamicToolUIPart,
  InferAgentUIMessage,
  InferUITools,
  LanguageModelUsage,
  ToolUIPart,
} from "ai";
import type { OpenHarnessAgentConfig } from "@open-harness/agent";
import type { webAgent } from "./config";

export type WebAgent = typeof webAgent;
export type WebAgentCallOptions = OpenHarnessAgentConfig;

export type WebAgentMessageMetadata = {
  lastStepUsage?: LanguageModelUsage;
  totalMessageUsage?: LanguageModelUsage;
};

// All types derived from the agent
export type WebAgentUIMessage = InferAgentUIMessage<
  WebAgent,
  WebAgentMessageMetadata
>;
export type WebAgentUIMessagePart = WebAgentUIMessage["parts"][number];
export type WebAgentTools = WebAgent["tools"];
export type WebAgentUITools = InferUITools<WebAgentTools>;
export type WebAgentUIToolPart =
  | DynamicToolUIPart
  | ToolUIPart<WebAgentUITools>;
