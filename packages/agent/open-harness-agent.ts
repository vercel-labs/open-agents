import type { Sandbox } from "@open-harness/sandbox";
import {
  gateway,
  type LanguageModel,
  stepCountIs,
  ToolLoopAgent,
  type ToolSet,
} from "ai";
import { addCacheControl } from "./context-management";

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

export type OpenHarnessAgentConfig = {
  sandbox: Sandbox;
  model?: LanguageModel;
  subagentModel?: LanguageModel;
  customInstructions?: string;
  skills?: SkillMetadata[];
};

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

export const createOpenHarnessAgent = ({
  sandbox,
  model = defaultModel,
  subagentModel,
  customInstructions,
  skills = [],
}: OpenHarnessAgentConfig) => {
  const instructions = buildSystemPrompt({
    cwd: sandbox.workingDirectory,
    currentBranch: sandbox.currentBranch,
    customInstructions,
    environmentDetails: sandbox.environmentDetails,
    skills,
    modelId: typeof model === "string" ? model : model.modelId,
  });

  return new ToolLoopAgent({
    model,
    instructions,
    tools: addCacheControl({
      tools,
      model,
    }),
    stopWhen: stepCountIs(200),
    experimental_context: {
      sandbox,
      skills,
      model,
      subagentModel,
    },
    prepareStep: ({ messages, model, steps: _steps }) => {
      return {
        messages: addCacheControl({
          messages,
          model,
        }),
      };
    },
  });
};

export type OpenHarnessAgent = ReturnType<typeof createOpenHarnessAgent>;
