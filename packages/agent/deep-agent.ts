import {
  ToolLoopAgent,
  stepCountIs,
  type LanguageModel,
  type ToolSet,
  type TypedToolResult,
  gateway,
} from "ai";
import { z } from "zod";
import {
  todoWriteTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  grepTool,
  globTool,
  bashTool,
  taskTool,
  askUserQuestionTool,
} from "./tools";
import { buildSystemPrompt } from "./system-prompt";
import type { TodoItem, ApprovalConfig } from "./types";
import { approvalRuleSchema } from "./types";
import { addCacheControl, compactContext } from "./context-management";
import type { Sandbox } from "@open-harness/sandbox";

const approvalConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("interactive"),
    autoApprove: z.enum(["off", "edits", "all"]).default("off"),
    sessionRules: z.array(approvalRuleSchema).default([]),
  }),
  z.object({ type: z.literal("background") }),
  z.object({ type: z.literal("delegated") }),
]);

const callOptionsSchema = z.object({
  sandbox: z.custom<Sandbox>(),
  approval: approvalConfigSchema,
  model: z.custom<LanguageModel>().optional(),
  customInstructions: z.string().optional(),
});

export type DeepAgentCallOptions = z.infer<typeof callOptionsSchema>;

export const defaultModel = gateway("anthropic/claude-haiku-4.5");
export const defaultModelLabel = defaultModel.modelId;

const tools = {
  todo_write: todoWriteTool,
  read: readFileTool(),
  write: writeFileTool(),
  edit: editFileTool(),
  grep: grepTool(),
  glob: globTool(),
  bash: bashTool(),
  task: taskTool,
  ask_user_question: askUserQuestionTool,
} satisfies ToolSet;

export const deepAgent = new ToolLoopAgent({
  model: defaultModel,
  instructions: buildSystemPrompt({}),
  tools,
  stopWhen: stepCountIs(50),
  callOptionsSchema,
  prepareStep: ({ messages, model, steps }) => ({
    messages: addCacheControl({
      messages: compactContext({ messages, steps }),
      model,
    }),
  }),
  prepareCall: ({ options, model, ...settings }) => {
    if (!options) {
      throw new Error(
        "Deep agent requires call options with sandbox and approval config.",
      );
    }
    const approval: ApprovalConfig = options.approval;
    const callModel = options.model ?? model;
    const customInstructions = options.customInstructions;
    const sandbox = options.sandbox;

    // Derive mode for system prompt (interactive vs background)
    const mode = approval.type === "background" ? "background" : "interactive";

    const instructions = buildSystemPrompt({
      cwd: sandbox.workingDirectory,
      mode,
      currentBranch: sandbox.currentBranch,
      customInstructions,
      environmentDetails: sandbox.environmentDetails,
    });

    return {
      ...settings,
      model: callModel,
      tools: addCacheControl({
        tools: settings.tools ?? tools,
        model: callModel,
      }),
      instructions,
      experimental_context: { sandbox, approval },
    };
  },
});

export function extractTodosFromStep(
  toolResults: Array<TypedToolResult<typeof deepAgent.tools>>,
): TodoItem[] | null {
  for (const result of toolResults) {
    if (!result.dynamic && result.toolName === "todo_write" && result.output) {
      return result.output.todos;
    }
  }
  return null;
}

export type DeepAgent = typeof deepAgent;
