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
} from "./tools";
import { buildSystemPrompt } from "./system-prompt";
import type { TodoItem, AgentMode, ApprovalRule } from "./types";
import { approvalRuleSchema } from "./types";
import { addCacheControl, compactContext } from "./context-management";
import type { Sandbox } from "@open-harness/sandbox";

const agentModeSchema = z.enum(["interactive", "background"]);
const autoApproveSchema = z.enum(["off", "edits", "all"]);

const approvalsSchema = z.object({
  autoApprove: autoApproveSchema.optional(),
  rules: z.array(approvalRuleSchema).optional(),
});

const callOptionsSchema = z.object({
  sandbox: z.custom<Sandbox>(),
  mode: agentModeSchema,
  model: z.custom<LanguageModel>().optional(),
  customInstructions: z.string().optional(),
  approvals: approvalsSchema.optional(),
});

export type DeepAgentCallOptions = z.infer<typeof callOptionsSchema>;

export const defaultModel = gateway("anthropic/claude-haiku-4.5");
export const defaultModelLabel = defaultModel.modelId;

const tools = {
  todo_write: todoWriteTool,
  read: readFileTool(),
  write: writeFileTool({ needsApproval: true }),
  edit: editFileTool({ needsApproval: true }),
  grep: grepTool(),
  glob: globTool(),
  bash: bashTool({ needsApproval: true }),
  task: taskTool,
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
        "Deep agent requires call options with sandbox and mode.",
      );
    }
    const mode: AgentMode = options.mode;
    const callModel = options.model ?? model;
    const autoApprove = options.approvals?.autoApprove ?? "off";
    const approvalRules: ApprovalRule[] = options.approvals?.rules ?? [];
    const customInstructions = options.customInstructions;
    const sandbox = options.sandbox;

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
      experimental_context: { sandbox, mode, autoApprove, approvalRules },
    };
  },
  // Sandbox lifecycle is managed by the consumer, not the agent.
  // Consumers should call sandbox.stop() when they're done with the sandbox.
  onFinish: async () => {},
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
