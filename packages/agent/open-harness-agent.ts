import type { Sandbox } from "@open-harness/sandbox";
import {
  gateway,
  type LanguageModel,
  stepCountIs,
  ToolLoopAgent,
  type ToolSet,
  type TypedToolResult,
} from "ai";
import { z } from "zod";
import { addCacheControl } from "./context-management";
import { aggressiveCompactContext } from "./context-management/aggressive-compaction";
import { preparePromptForOpenAIReasoning } from "./openai-reasoning";
import {
  getCurrentBranchFromSandboxConfig,
  getEnvironmentDetailsFromSandboxConfig,
  getWorkingDirectoryFromSandboxConfig,
  sandboxConfigSchema,
} from "./sandbox-config";

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
import type { ApprovalConfig, TodoItem } from "./types";
import { approvalRuleSchema } from "./types";

const approvalConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("interactive"),
    autoApprove: z.enum(["off", "edits", "all"]).default("off"),
    sessionRules: z.array(approvalRuleSchema).default([]),
  }),
  z.object({ type: z.literal("background") }),
  z.object({ type: z.literal("delegated") }),
]);

const compactionContextSchema = z.object({
  contextLimit: z.number().int().positive().optional(),
  lastInputTokens: z.number().int().nonnegative().optional(),
});

const callOptionsSchema = z.object({
  sandboxConfig: sandboxConfigSchema,
  approval: approvalConfigSchema,
  model: z.custom<LanguageModel>().optional(),
  subagentModel: z.custom<LanguageModel>().optional(),
  customInstructions: z.string().optional(),
  skills: z.custom<SkillMetadata[]>().optional(),
  context: compactionContextSchema.optional(),
});

type CompactionContext = z.infer<typeof compactionContextSchema>;

export type { OpenHarnessSandboxConfig } from "./sandbox-config";

export type OpenHarnessAgentCallOptions = z.infer<typeof callOptionsSchema>;

const runtimeContextSchema = z.object({
  sandboxConfig: sandboxConfigSchema,
  workingDirectory: z.string(),
  currentBranch: z.string().optional(),
  environmentDetails: z.string().optional(),
  approval: approvalConfigSchema,
  model: z.custom<LanguageModel>(),
  subagentModel: z.custom<LanguageModel>().optional(),
  customInstructions: z.string().optional(),
  skills: z.custom<SkillMetadata[]>().optional(),
  context: compactionContextSchema.optional(),
  sandbox: z.custom<Sandbox>().optional(),
});

type AgentRuntimeContext = z.infer<typeof runtimeContextSchema>;

function getRuntimeContext(
  experimentalContext: unknown,
): AgentRuntimeContext | undefined {
  const parsed = runtimeContextSchema.safeParse(experimentalContext);
  return parsed.success ? parsed.data : undefined;
}

function getCompactionContextFromExperimentalContext(
  experimentalContext: unknown,
): CompactionContext | undefined {
  return getRuntimeContext(experimentalContext)?.context;
}

const DEFAULT_CONTEXT_LIMIT = 200_000;

interface CompactionTuning {
  triggerPercent: number;
  minSavingsPercent: number;
  retainRecentToolCalls: number;
}

const DEFAULT_COMPACTION_TUNING: CompactionTuning = {
  triggerPercent: 0.58,
  minSavingsPercent: 0.03,
  retainRecentToolCalls: 32,
};

/**
 * Optional model-specific compaction tuning overrides.
 *
 * Keys support exact matches ("provider/model") and partial matches
 * (any substring of the full model id).
 */
const MODEL_COMPACTION_TUNING_OVERRIDES: Record<
  string,
  Partial<CompactionTuning>
> = {};

function getModelId(model: LanguageModel): string {
  return typeof model === "string" ? model : model.modelId;
}

function resolveCompactionTuning(model: LanguageModel): CompactionTuning {
  const modelId = getModelId(model);

  const exactMatch = MODEL_COMPACTION_TUNING_OVERRIDES[modelId];
  if (exactMatch) {
    return {
      ...DEFAULT_COMPACTION_TUNING,
      ...exactMatch,
    };
  }

  const partialMatch = Object.entries(MODEL_COMPACTION_TUNING_OVERRIDES).find(
    ([key]) => modelId.includes(key),
  );

  if (partialMatch?.[1]) {
    return {
      ...DEFAULT_COMPACTION_TUNING,
      ...partialMatch[1],
    };
  }

  return DEFAULT_COMPACTION_TUNING;
}

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
  prepareStep: ({ messages, model, steps, experimental_context }) => {
    const runtimeContext = getRuntimeContext(experimental_context);
    if (!runtimeContext) {
      throw new Error(
        "Open Harness agent missing runtime context. Ensure prepareCall sets sandboxConfig and approval.",
      );
    }

    const workingDirectory =
      runtimeContext.sandbox?.workingDirectory ??
      runtimeContext.workingDirectory;
    const currentBranch =
      runtimeContext.sandbox?.currentBranch ?? runtimeContext.currentBranch;
    const environmentDetails =
      runtimeContext.sandbox?.environmentDetails ??
      runtimeContext.environmentDetails;
    const mode =
      runtimeContext.approval.type === "background" && currentBranch
        ? "background"
        : "interactive";
    const skills = runtimeContext.skills ?? [];
    const callContext =
      getCompactionContextFromExperimentalContext(experimental_context);
    const compactionTuning = resolveCompactionTuning(model);

    return {
      messages: addCacheControl({
        messages: aggressiveCompactContext({
          messages,
          steps,
          contextLimit: callContext?.contextLimit ?? DEFAULT_CONTEXT_LIMIT,
          lastInputTokens: callContext?.lastInputTokens,
          triggerPercent: compactionTuning.triggerPercent,
          minSavingsPercent: compactionTuning.minSavingsPercent,
          retainRecentToolCalls: compactionTuning.retainRecentToolCalls,
        }),
        model,
      }),
      instructions: buildSystemPrompt({
        cwd: workingDirectory,
        mode,
        currentBranch,
        customInstructions: runtimeContext.customInstructions,
        environmentDetails,
        skills,
        modelId: getModelId(model),
      }),
      experimental_context: {
        ...runtimeContext,
        model,
      },
    };
  },
  prepareCall: ({ options, model, ...settings }) => {
    if (!options) {
      throw new Error(
        "Open Harness agent requires call options with sandboxConfig and approval config.",
      );
    }
    const approval: ApprovalConfig = options.approval;
    const callModel = options.model ?? model;
    const subagentModel = options.subagentModel;
    const customInstructions = options.customInstructions;
    const sandboxConfig = options.sandboxConfig;
    const workingDirectory =
      getWorkingDirectoryFromSandboxConfig(sandboxConfig);
    const currentBranch = getCurrentBranchFromSandboxConfig(sandboxConfig);
    const environmentDetails =
      getEnvironmentDetailsFromSandboxConfig(sandboxConfig);
    const skills = options.skills ?? [];
    const context = options.context;
    const preparedPrompt = preparePromptForOpenAIReasoning({
      model: callModel,
      messages: settings.messages,
      prompt: settings.prompt,
    });

    return {
      ...settings,
      ...preparedPrompt,
      model: callModel,
      tools: addCacheControl({
        tools: settings.tools ?? tools,
        model: callModel,
      }),
      experimental_context: {
        sandboxConfig,
        workingDirectory,
        currentBranch,
        environmentDetails,
        approval,
        skills,
        model: callModel,
        subagentModel,
        customInstructions,
        context,
      },
    };
  },
});

export function extractTodosFromStep(
  toolResults: Array<TypedToolResult<typeof openHarnessAgent.tools>>,
): TodoItem[] | null {
  for (const result of toolResults) {
    if (!result.dynamic && result.toolName === "todo_write" && result.output) {
      return result.output.todos;
    }
  }
  return null;
}

export type OpenHarnessAgent = typeof openHarnessAgent;
