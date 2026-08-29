import type { SandboxState } from "@open-agents/sandbox";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { AgentSandboxContext } from "./open-agent";
import type { SkillMetadata } from "./skills/types";

export {
  todoItemSchema,
  todoStatusSchema,
  type TodoItem,
  type TodoStatus,
} from "@open-agents/shared/lib/chat-tools";

export type AgentContext = {
  sandbox: AgentSandboxContext;
  skills?: SkillMetadata[];
  model: LanguageModel;
  subagentModel?: LanguageModel;
};

export function isAgentContext(value: unknown): value is AgentContext {
  return (
    typeof value === "object" &&
    value !== null &&
    "sandbox" in value &&
    "model" in value
  );
}

export const agentContextSchema = z.custom<AgentContext>(isAgentContext);

export interface SandboxExecutionContext {
  sandbox: AgentSandboxContext;
}

export function isSandboxState(value: unknown): value is SandboxState {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "vercel"
  );
}

export const EVICTION_THRESHOLD_BYTES = 80 * 1024;
