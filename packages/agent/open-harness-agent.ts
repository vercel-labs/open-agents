import type { Sandbox } from "@open-harness/sandbox";
import {
  gateway,
  type LanguageModel,
  stepCountIs,
  ToolLoopAgent,
  type ToolSet,
} from "ai";
import { z } from "zod";
import { addCacheControl } from "./context-management";
import { preparePromptForOpenAIReasoning } from "./openai-reasoning";

import type { SkillMetadata } from "./skills/types";
import { buildSystemPrompt } from "./system-prompt";
import {
  askUserQuestionTool,
  bashTool,
  editFileTool,
  globTool,
  grepTool,
  readFileTool,
  skillTool,
  taskTool,
  todoWriteTool,
  webFetchTool,
  writeFileTool,
} from "./tools";

const callOptionsSchema = z.object({
  sandbox: z.custom<Sandbox>(),
  model: z.custom<LanguageModel>().optional(),
  subagentModel: z.custom<LanguageModel>().optional(),
  customInstructions: z.string().optional(),
  skills: z.custom<SkillMetadata[]>().optional(),
});

export type OpenHarnessAgentCallOptions = z.infer<typeof callOptionsSchema>;

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
  skill: skillTool,
  web_fetch: webFetchTool,
} satisfies ToolSet;

export const openHarnessAgent = new ToolLoopAgent({
  model: defaultModel,
  instructions: buildSystemPrompt({}),
  tools,
  stopWhen: stepCountIs(200),
  callOptionsSchema,
  prepareStep: ({ messages, model, steps: _steps }) => {
    return {
      messages: addCacheControl({
        messages,
        model,
      }),
    };
  },
  prepareCall: ({ options, model, ...settings }) => {
    if (!options) {
      throw new Error("Open Harness agent requires call options with sandbox.");
    }
    const callModel = options.model ?? model;
    const subagentModel = options.subagentModel;
    const customInstructions = options.customInstructions;
    const sandbox = options.sandbox;
    const skills = options.skills ?? [];
    const preparedPrompt = preparePromptForOpenAIReasoning({
      model: callModel,
      messages: settings.messages,
      prompt: settings.prompt,
    });

    const instructions = buildSystemPrompt({
      cwd: sandbox.workingDirectory,
      currentBranch: sandbox.currentBranch,
      customInstructions,
      environmentDetails: sandbox.environmentDetails,
      skills,
      modelId: typeof callModel === "string" ? callModel : callModel.modelId,
    });

    return {
      ...settings,
      ...preparedPrompt,
      model: callModel,
      tools: addCacheControl({
        tools: settings.tools ?? tools,
        model: callModel,
      }),
      instructions,
      experimental_context: {
        sandbox,
        skills,
        model: callModel,
        subagentModel,
      },
    };
  },
});

export type OpenHarnessAgent = typeof openHarnessAgent;
