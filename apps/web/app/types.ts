import type {
  DynamicToolUIPart,
  InferAgentUIMessage,
  InferUITools,
  LanguageModelUsage,
  ToolUIPart,
} from "ai";
import type { webAgent } from "./config";

export type WebAgent = typeof webAgent;
export type WebAgentCallOptions = Parameters<
  WebAgent["generate"]
>["0"]["options"];

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
