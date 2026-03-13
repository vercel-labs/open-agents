import type { Sandbox } from "@open-harness/sandbox";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { SkillMetadata } from "./skills/types";

export const todoStatusSchema = z.enum(["pending", "in_progress", "completed"]);
export type TodoStatus = z.infer<typeof todoStatusSchema>;

export const todoItemSchema = z.object({
  id: z.string().describe("Unique identifier for the todo item"),
  content: z.string().describe("The task description"),
  status: todoStatusSchema.describe(
    "Current status. Only ONE task should be in_progress at a time.",
  ),
});
export type TodoItem = z.infer<typeof todoItemSchema>;

export interface AgentContext {
  sandbox: Sandbox;
  skills?: SkillMetadata[];
  model: LanguageModel;
  subagentModel?: LanguageModel;
}

export const EVICTION_THRESHOLD_BYTES = 80 * 1024;
