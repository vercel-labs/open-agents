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
import { formatTodosForContext, formatScratchpadForContext } from "./state";
import type { TodoItem, ScratchpadEntry } from "./types";
import { todoItemSchema } from "./types";
import { addCacheControl, compactContext, sharedContext } from "./utils";
import { gateway } from "../models";
import { createLocalSandbox, type Sandbox } from "./sandbox";

const callOptionsSchema = z.object({
  workingDirectory: z.string(),
  customInstructions: z.string().optional(),
  todos: z.array(todoItemSchema).optional(),
  scratchpad: z
    .map(
      z.string(),
      z.object({
        path: z.string(),
        content: z.string(),
        createdAt: z.number(),
        updatedAt: z.number(),
        size: z.number(),
      }),
    )
    .optional(),
  sandbox: z.custom<Sandbox>().optional(),
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
      // memory_save: memorySaveTool,
      // memory_recall: memoryRecallTool,
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
    // Update shared context for tool approval functions
    sharedContext.workingDirectory = workingDirectory;
    const customInstructions = options?.customInstructions;
    const todos = options?.todos ?? [];
    const scratchpad =
      options?.scratchpad ?? new Map<string, ScratchpadEntry>();

    // Use provided sandbox, or create a local sandbox with the working directory
    const sandbox =
      options?.sandbox ?? createLocalSandbox(workingDirectory);

    const todosContext = formatTodosForContext(todos);
    const scratchpadContext = formatScratchpadForContext(scratchpad);

    return {
      ...settings,
      model,
      instructions: buildSystemPrompt({
        cwd: sandbox.workingDirectory,
        customInstructions,
        todosContext,
        scratchpadContext,
      }),
      experimental_context: { sandbox },
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
