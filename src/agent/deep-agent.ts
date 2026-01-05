import {
  ToolLoopAgent,
  stepCountIs,
  wrapLanguageModel,
  type TypedToolResult,
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
} from "./tools";
import { buildSystemPrompt } from "./system-prompt";
import type { TodoItem, AgentMode, ApprovalRule } from "./types";
import { approvalRuleSchema } from "./types";
import { addCacheControl, compactContext, getSandbox, sharedContext } from "./utils";
import { gateway } from "../models";
import { createLocalSandbox, type Sandbox } from "./sandbox";

const agentModeSchema = z.enum(["interactive", "background"]);
const autoApproveSchema = z.enum(["off", "edits", "all"]);

const callOptionsSchema = z.object({
  workingDirectory: z.string(),
  mode: agentModeSchema.optional(),
  customInstructions: z.string().optional(),
  sandbox: z.custom<Sandbox>().optional(),
  autoApprove: autoApproveSchema.optional(),
  approvalRules: z.array(approvalRuleSchema).optional(),
});

export type DeepAgentCallOptions = z.infer<typeof callOptionsSchema>;

const model = gateway("anthropic/claude-haiku-4.5", {
  devtools: true,
});

export const deepAgentModelId = model.modelId;

export const deepAgent = new ToolLoopAgent({
  model,
  instructions: buildSystemPrompt({}),
  tools: addCacheControl({
    tools: {
      todo_write: todoWriteTool,
      read: readFileTool(),
      write: writeFileTool({ needsApproval: true }),
      edit: editFileTool({ needsApproval: true }),
      grep: grepTool(),
      glob: globTool(),
      bash: bashTool({ needsApproval: true }),
      task: taskTool,
    },
    model,
  }),
  stopWhen: stepCountIs(50),
  callOptionsSchema,
  prepareStep: ({ messages, model, steps }) => ({
    messages: addCacheControl({
      messages: compactContext({ messages, steps }),
      model,
    }),
  }),
  prepareCall: ({ options, model, ...settings }) => {
    const workingDirectory = options?.workingDirectory ?? process.cwd();
    const mode: AgentMode = options?.mode ?? "interactive";
    const autoApprove = options?.autoApprove ?? "off";
    const approvalRules: ApprovalRule[] = options?.approvalRules ?? [];

    // Update shared context for tool approval functions
    sharedContext.workingDirectory = workingDirectory;
    sharedContext.mode = mode;
    sharedContext.autoApprove = autoApprove;
    sharedContext.approvalRules = approvalRules;

    const customInstructions = options?.customInstructions;

    // Use provided sandbox, or create a local sandbox with the working directory
    const sandbox =
      options?.sandbox ?? createLocalSandbox(workingDirectory);

    return {
      ...settings,
      model,
      instructions: buildSystemPrompt({
        cwd: sandbox.workingDirectory,
        mode,
        currentBranch: sandbox.currentBranch,
        customInstructions,
      }),
      experimental_context: { sandbox, mode },
    };
  },
  onFinish: async ({ experimental_context }) => {
    try {
      const sandbox = getSandbox(experimental_context);
      await sandbox.stop();
    } catch {
      // Sandbox not available, nothing to clean up
    }
  }
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
