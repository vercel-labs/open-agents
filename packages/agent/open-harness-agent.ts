import type { Sandbox } from "@open-harness/sandbox";
import { stepCountIs, ToolLoopAgent, type ToolSet } from "ai";
import {
  gateway,
  type GatewayModelId,
  type ProviderOptionsByProvider,
} from "./models";
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

export interface AgentModelSelection {
  id: GatewayModelId;
  providerOptionsOverrides?: ProviderOptionsByProvider;
}

export type OpenHarnessAgentModelInput = GatewayModelId | AgentModelSelection;

export type OpenHarnessAgentConfig = {
  sandbox: Sandbox;
  model?: OpenHarnessAgentModelInput;
  subagentModel?: OpenHarnessAgentModelInput;
  customInstructions?: string;
  skills?: SkillMetadata[];
};

export const defaultModelLabel = "anthropic/claude-haiku-4.5" as const;
export const defaultModel = gateway(defaultModelLabel);

function resolveAgentModelSelection(
  selection: OpenHarnessAgentModelInput | undefined,
  fallbackId: GatewayModelId,
): AgentModelSelection {
  if (!selection) {
    return { id: fallbackId };
  }

  if (typeof selection === "string") {
    return { id: selection };
  }

  return selection;
}

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
  model = defaultModelLabel,
  subagentModel,
  customInstructions,
  skills = [],
}: OpenHarnessAgentConfig) => {
  const mainSelection = resolveAgentModelSelection(model, defaultModelLabel);
  const subagentSelection = subagentModel
    ? resolveAgentModelSelection(subagentModel, defaultModelLabel)
    : undefined;

  const mainModel = gateway(mainSelection.id, {
    providerOptionsOverrides: mainSelection.providerOptionsOverrides,
  });
  const resolvedSubagentModel = subagentSelection
    ? gateway(subagentSelection.id, {
        providerOptionsOverrides: subagentSelection.providerOptionsOverrides,
      })
    : undefined;

  const instructions = buildSystemPrompt({
    cwd: sandbox.workingDirectory,
    currentBranch: sandbox.currentBranch,
    customInstructions,
    environmentDetails: sandbox.environmentDetails,
    skills,
    modelId: mainSelection.id,
  });

  return new ToolLoopAgent({
    model: mainModel,
    instructions,
    tools: addCacheControl({
      tools,
      model: mainModel,
    }),
    stopWhen: stepCountIs(200),
    experimental_context: {
      sandbox,
      skills,
      model: mainModel,
      subagentModel: resolvedSubagentModel,
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
