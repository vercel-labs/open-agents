import {
  type LanguageModelUsage,
  readUIMessageStream,
  tool,
  type UIToolInvocation,
} from "ai";
import { z } from "zod";
import { executorSubagent } from "../subagents/executor";
import { explorerSubagent } from "../subagents/explorer";
import type { SubagentUIMessage } from "../subagents/types";
import type { ApprovalRule } from "../types";
import {
  getApprovalContext,
  getModel,
  getSandbox,
  shouldAutoApprove,
} from "./utils";

const subagentTypeSchema = z.enum(["explorer", "executor"]);

const taskInputSchema = z.object({
  subagentType: subagentTypeSchema.describe(
    "Type of subagent: 'explorer' for read-only research, 'executor' for implementation tasks",
  ),
  task: z
    .string()
    .describe("Short description of the task (displayed to user)"),
  instructions: z.string().describe(
    `Detailed instructions for the subagent. Include:
- Goal and deliverables
- Step-by-step procedure
- Constraints and patterns to follow
- How to verify the work`,
  ),
});

/**
 * Check if a subagent type matches any approval rules.
 */
function subagentMatchesApprovalRule(
  subagentType: string,
  approvalRules: ApprovalRule[],
): boolean {
  for (const rule of approvalRules) {
    if (rule.type === "subagent-type" && rule.tool === "task") {
      if (rule.subagentType === subagentType) {
        return true;
      }
    }
  }
  return false;
}

export const taskTool = tool({
  // Executor subagent has full write access, so require approval
  // Explorer is read-only, so no approval needed
  needsApproval: ({ subagentType }, { experimental_context }) => {
    const ctx = getApprovalContext(experimental_context, "task");
    const { approval } = ctx;

    // Explorer never needs approval
    if (subagentType !== "executor") {
      return false;
    }

    // Background and delegated modes auto-approve
    if (shouldAutoApprove(approval)) {
      return false;
    }

    // Type guard narrowed approval to interactive mode
    // Check if a session rule matches this subagent type
    if (subagentMatchesApprovalRule(subagentType, approval.sessionRules)) {
      return false;
    }

    // Default: executor needs approval
    return true;
  },
  description: `Launch a specialized subagent to handle complex tasks autonomously.

SUBAGENT TYPES:

1. **explorer** (READ-ONLY)
   - Use for: Finding files, searching code, answering questions about the codebase
   - Tools: read, grep, glob, bash (read-only commands only)
   - CANNOT create, modify, or delete files
   - Best for: Research, codebase exploration, finding implementations

2. **executor** (FULL ACCESS)
   - Use for: Implementation tasks that require creating or modifying files
   - Tools: read, write, edit, grep, glob, bash
   - CAN create, modify, and delete files
   - Best for: Feature scaffolding, refactors, migrations, code generation

WHEN TO USE EXPLORER:
- "Where is X implemented?"
- "Find all usages of Y"
- "How does Z work in this codebase?"
- Gathering context before making changes

WHEN TO USE EXECUTOR:
- Feature scaffolding that touches multiple files
- Cross-layer refactors requiring coordinated changes
- Mass migrations or boilerplate generation
- Any implementation task where detailed execution would clutter the main conversation

WHEN NOT TO USE (do it yourself):
- Simple, single-file or single-change edits
- Tasks where you already have all the context you need

BEHAVIOR:
- Subagents work AUTONOMOUSLY without asking follow-up questions
- They run up to 30 tool steps and then return
- They return ONLY a concise summary - their internal steps are isolated from the parent

HOW TO USE:
- Choose the appropriate subagentType based on whether you need read-only or write access
- Provide a short task string (for display) summarizing the goal
- Provide detailed instructions including goals, steps, constraints, and verification criteria

IMPORTANT:
- Be explicit and concrete - subagents cannot ask clarifying questions
- Include critical context (APIs, function names, file paths) in the instructions
- The parent agent will not see the subagent's internal tool calls, only its final summary

NOTE: The executor subagent requires user approval before running because it has full write access.`,
  inputSchema: taskInputSchema,
  execute: async function* (
    { subagentType, task, instructions },
    { experimental_context, abortSignal },
  ) {
    const sandbox = getSandbox(experimental_context, "task");
    const model = getModel(experimental_context, "task");

    const subagent =
      subagentType === "explorer" ? explorerSubagent : executorSubagent;

    const result = await subagent.stream({
      prompt:
        "Complete this task and provide a summary of what you accomplished.",
      options: { task, instructions, sandbox, model },
      abortSignal,
    });

    // Track last step usage for message metadata
    let lastStepUsage: LanguageModelUsage | undefined;

    for await (const message of readUIMessageStream<SubagentUIMessage>({
      stream: result.toUIMessageStream<SubagentUIMessage>({
        messageMetadata: ({ part }) => {
          // Track per-step usage from finish-step events
          if (part.type === "finish-step") {
            lastStepUsage = part.usage;
            return { lastStepUsage, totalMessageUsage: undefined };
          }
          // On finish, include both the last step usage and total message usage
          if (part.type === "finish") {
            return { lastStepUsage, totalMessageUsage: part.totalUsage };
          }
        },
      }),
    })) {
      yield message;
    }
  },
  toModelOutput: ({ output: message }) => {
    if (!message) {
      return { type: "text", value: "Task completed." };
    }

    const lastTextPart = message.parts.findLast((p) => p.type === "text");

    if (!lastTextPart || lastTextPart.type !== "text") {
      return { type: "text", value: "Task completed." };
    }

    return { type: "text", value: lastTextPart.text };
  },
});

export type TaskToolUIPart = UIToolInvocation<typeof taskTool>;
