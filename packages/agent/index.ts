export {
  deepAgent,
  defaultModel,
  defaultModelLabel,
  extractTodosFromStep,
} from "./deep-agent";
export type { DeepAgentCallOptions } from "./deep-agent";
export { gateway } from "./models";
export type {
  TodoItem,
  TodoStatus,
  ApprovalConfig,
  ApprovalRule,
} from "./types";
export { DEEP_AGENT_SYSTEM_PROMPT, buildSystemPrompt } from "./system-prompt";
export type { BuildSystemPromptOptions } from "./system-prompt";

// Context management exports
export {
  getContextLimit,
  getModelLabel,
} from "./context-management/model-limits";

// Tool exports
export { type TaskToolUIPart } from "./tools/task";
export {
  type AskUserQuestionToolUIPart,
  type AskUserQuestionInput,
  type AskUserQuestionOutput,
} from "./tools/ask-user-question";

// Subagent type exports
export type {
  SubagentMessageMetadata,
  SubagentUIMessage,
} from "./subagents/types";

// Skills exports
export { discoverSkills, parseSkillFrontmatter } from "./skills/discovery";
export { extractSkillBody, substituteArguments } from "./skills/loader";
export type {
  SkillMetadata,
  SkillOptions,
  SkillFrontmatter,
} from "./skills/types";
export { skillFrontmatterSchema, frontmatterToOptions } from "./skills/types";
export type { SkillToolInput } from "./tools/skill";

// Proxy gateway exports
export { createProxyGateway } from "./proxy-gateway";
export type { ProxyConfig } from "./proxy-gateway";
