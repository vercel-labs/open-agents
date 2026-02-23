import type { Sandbox } from "@open-harness/sandbox";
import type { LanguageModel } from "ai";
import { z } from "zod";

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

/**
 * Approval configuration using a discriminated union that makes the trust model explicit.
 *
 * - 'interactive': Human in the loop, local development. Uses autoApprove and sessionRules.
 * - 'background': Async execution, cloud sandbox. Auto-approve all tools, checkpoint via git.
 * - 'delegated': Subagent inherits trust from parent agent. Auto-approve all tools.
 */
export type ApprovalConfig =
  | {
      type: "interactive";
      autoApprove: "off" | "edits" | "all";
      sessionRules: ApprovalRule[];
    }
  | { type: "background" }
  | { type: "delegated" };

import type { SkillMetadata } from "./skills/types";

export interface AgentContext {
  sandbox: Sandbox;
  approval: ApprovalConfig;
  skills?: SkillMetadata[];
  model: LanguageModel;
  subagentModel?: LanguageModel;
}

/**
 * Approval rules for auto-approving tool operations within a session.
 * Rules are matched against tool arguments to skip manual approval.
 *
 * Path-glob rules can match paths both inside and outside the working directory.
 * This allows users to grant persistent approval for specific external paths.
 */
export const approvalRuleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("command-prefix"),
    tool: z.literal("bash"),
    prefix: z.string().min(1, "Prefix cannot be empty"),
  }),
  z.object({
    type: z.literal("path-glob"),
    tool: z.enum(["read", "write", "edit", "grep", "glob"]),
    glob: z.string(),
  }),
  z.object({
    type: z.literal("subagent-type"),
    tool: z.literal("task"),
    subagentType: z.enum(["explorer", "executor"]),
  }),
  z.object({
    type: z.literal("skill"),
    tool: z.literal("skill"),
    skillName: z.string().min(1, "Skill name cannot be empty"),
  }),
]);

export type ApprovalRule = z.infer<typeof approvalRuleSchema>;

export const EVICTION_THRESHOLD_BYTES = 80 * 1024;
