import type {
  DynamicToolUIPart,
  FinishReason,
  InferUITools,
  LanguageModelUsage,
  ToolUIPart,
  UIMessage,
} from "ai";
import type { webAgent } from "./config";

export type WebAgent = typeof webAgent;
export type WebAgentCallOptions = Parameters<
  WebAgent["generate"]
>["0"]["options"];

export type WebAgentStepFinishMetadata = {
  finishReason: FinishReason;
  rawFinishReason?: string;
};

export type WebAgentMessageMetadata = {
  selectedModelId?: string;
  modelId?: string;
  lastStepUsage?: LanguageModelUsage;
  totalMessageUsage?: LanguageModelUsage;
  lastStepFinishReason?: FinishReason;
  lastStepRawFinishReason?: string;
  stepFinishReasons?: WebAgentStepFinishMetadata[];
};

export type WebAgentGitDataStatus = "pending" | "success" | "error" | "skipped";

export type WebAgentCommitData = {
  status: WebAgentGitDataStatus;
  committed?: boolean;
  pushed?: boolean;
  commitMessage?: string;
  commitSha?: string;
  url?: string;
  error?: string;
};

export type WebAgentPrData = {
  status: WebAgentGitDataStatus;
  created?: boolean;
  syncedExisting?: boolean;
  prNumber?: number;
  url?: string;
  error?: string;
  skipReason?: string;
  requiresManualCreation?: boolean;
};

export type WebAgentSnippetData = {
  content: string;
  filename: string;
};

export type WebAgentDataParts = {
  commit: WebAgentCommitData;
  pr: WebAgentPrData;
  snippet: WebAgentSnippetData;
};

// All types derived from the agent
export type WebAgentTools = WebAgent["tools"];
export type WebAgentUITools = InferUITools<WebAgentTools>;
export type WebAgentUIMessage = UIMessage<
  WebAgentMessageMetadata,
  WebAgentDataParts,
  WebAgentUITools
>;
export type WebAgentUIMessagePart = WebAgentUIMessage["parts"][number];
export type WebAgentCommitDataPart = Extract<
  WebAgentUIMessagePart,
  { type: "data-commit" }
>;
export type WebAgentPrDataPart = Extract<
  WebAgentUIMessagePart,
  { type: "data-pr" }
>;
export type WebAgentSnippetDataPart = Extract<
  WebAgentUIMessagePart,
  { type: "data-snippet" }
>;
export type WebAgentUIToolPart =
  | DynamicToolUIPart
  | ToolUIPart<WebAgentUITools>;
