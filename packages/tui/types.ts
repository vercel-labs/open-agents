import type {
  DynamicToolUIPart,
  InferAgentUIMessage,
  InferUITools,
  LanguageModelUsage,
  ToolUIPart,
} from "ai";
import type { Sandbox } from "@open-harness/sandbox";
import type { tuiAgent } from "./config";

export type TUIAgent = typeof tuiAgent;
export type TUIAgentCallOptions = Parameters<
  TUIAgent["generate"]
>["0"]["options"];

export type TUIAgentMessageMetadata = {
  usage: LanguageModelUsage;
};

// all derived
export type TUIAgentUIMessage = InferAgentUIMessage<
  TUIAgent,
  TUIAgentMessageMetadata
>;
export type TUIAgentUIMessagePart = TUIAgentUIMessage["parts"][number];
export type TUIAgentTools = TUIAgent["tools"];
export type TUIAgentUITools = InferUITools<TUIAgentTools>;
export type TUIAgentUIToolPart =
  | DynamicToolUIPart
  | ToolUIPart<TUIAgentUITools>;

/* --- */
export type AutoAcceptMode = "off" | "edits" | "all";

// Re-export ApprovalRule for client-side use
export type { ApprovalRule } from "@open-harness/agent";

export type TUIOptions = {
  /** Initial prompt to run (for one-shot mode) */
  initialPrompt?: string;
  /** Working directory for display/approval context */
  workingDirectory?: string;
  /** Sandbox to use when agentOptions are not provided */
  sandbox?: Sandbox;
  /** Custom agent options (defaults provided if not specified) */
  agentOptions?: TUIAgentCallOptions;
  /** Header configuration */
  header?: {
    name?: string;
    version?: string;
    model?: string;
  };
  /** Initial auto-accept mode (defaults to "off") */
  initialAutoAcceptMode?: AutoAcceptMode;
};
