import {
  getToolName,
  isToolUIPart,
  type LanguageModelUsage,
  type UIMessage,
} from "ai";
import { addLanguageModelUsage } from "@open-agents/shared/lib/usage";

export {
  addLanguageModelUsage,
  sumLanguageModelUsage,
} from "@open-agents/shared/lib/usage";

export type TaskToolUsageEvent = {
  usage: LanguageModelUsage;
  modelId?: string;
  toolCallId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isLanguageModelUsage(value: unknown): value is LanguageModelUsage {
  if (!isRecord(value)) {
    return false;
  }
  const inputTokenDetails = value.inputTokenDetails;
  const outputTokenDetails = value.outputTokenDetails;
  return (
    isRecord(inputTokenDetails) ||
    isRecord(outputTokenDetails) ||
    isNumber(value.inputTokens) ||
    isNumber(value.outputTokens) ||
    isNumber(value.totalTokens)
  );
}

function extractTaskOutputUsage(
  output: unknown,
  toolCallId?: string,
): TaskToolUsageEvent | undefined {
  if (!isRecord(output)) {
    return undefined;
  }

  // New output shape: {
  //   usage?: LanguageModelUsage,
  //   final?: ModelMessage[],
  //   modelId?: string,
  // }
  const usage = output.usage;
  const modelId =
    typeof output.modelId === "string" ? output.modelId : undefined;
  if (isLanguageModelUsage(usage)) {
    return { usage, modelId, toolCallId };
  }

  // Legacy fallback: { metadata: { totalMessageUsage?, lastStepUsage?, modelId? } }
  const metadata = output.metadata;
  if (!isRecord(metadata)) {
    return undefined;
  }
  const legacyModelId =
    typeof metadata.modelId === "string" ? metadata.modelId : undefined;
  const totalMessageUsage = metadata.totalMessageUsage;
  if (isLanguageModelUsage(totalMessageUsage)) {
    return { usage: totalMessageUsage, modelId: legacyModelId, toolCallId };
  }
  const lastStepUsage = metadata.lastStepUsage;
  if (isLanguageModelUsage(lastStepUsage)) {
    return { usage: lastStepUsage, modelId: legacyModelId, toolCallId };
  }
  return undefined;
}

export function collectTaskToolUsageEvents(
  message: UIMessage,
): TaskToolUsageEvent[] {
  const events: TaskToolUsageEvent[] = [];
  for (const part of message.parts) {
    if (!isToolUIPart(part)) {
      continue;
    }
    const toolName = getToolName(part);
    if (toolName !== "task" && part.type !== "tool-task") {
      continue;
    }
    if (!part.output) {
      continue;
    }
    const toolCallId =
      typeof part.toolCallId === "string" ? part.toolCallId : undefined;
    const usage = extractTaskOutputUsage(part.output, toolCallId);
    if (!usage) {
      continue;
    }
    events.push(usage);
  }
  return events;
}

export function collectTaskToolUsage(
  message: UIMessage,
): LanguageModelUsage | undefined {
  const events = collectTaskToolUsageEvents(message);
  let totalUsage: LanguageModelUsage | undefined;
  for (const event of events) {
    totalUsage = totalUsage
      ? addLanguageModelUsage(totalUsage, event.usage)
      : event.usage;
  }
  return totalUsage;
}
