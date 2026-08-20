import {
  addLanguageModelUsage,
  sumOptionalNumbers,
} from "@open-agents/shared/lib/usage";
import type { FinishReason, LanguageModelUsage, UIMessage } from "ai";
import { z } from "zod";
import { HARNESS_DEFINITIONS } from "./adapters.ts";
import type { ExternalHarnessId } from "./ids.ts";

/**
 * Usage payload persisted in harness message metadata. Extends the AI SDK
 * usage shape with the legacy top-level cached/reasoning token fields the web
 * UI still reads, plus the harness-reported dollar cost.
 */
export type HarnessUsage = LanguageModelUsage & {
  cachedInputTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
};

/** Add two harness usage payloads together, keeping undefined fields sparse. */
export function addHarnessUsage(
  usage1: HarnessUsage,
  usage2: HarnessUsage,
): HarnessUsage {
  const cachedInputTokens = sumOptionalNumbers(
    usage1.cachedInputTokens,
    usage2.cachedInputTokens,
  );
  const reasoningTokens = sumOptionalNumbers(
    usage1.reasoningTokens,
    usage2.reasoningTokens,
  );
  const costUsd = sumOptionalNumbers(usage1.costUsd, usage2.costUsd);

  return {
    ...addLanguageModelUsage(usage1, usage2),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
}

const optionalTokenCountSchema = z.number().optional();

const harnessUsageSchema = z.object({
  inputTokens: optionalTokenCountSchema,
  outputTokens: optionalTokenCountSchema,
  totalTokens: optionalTokenCountSchema,
  cachedInputTokens: optionalTokenCountSchema,
  reasoningTokens: optionalTokenCountSchema,
  costUsd: z.number().optional(),
  inputTokenDetails: z
    .object({
      noCacheTokens: optionalTokenCountSchema,
      cacheReadTokens: optionalTokenCountSchema,
      cacheWriteTokens: optionalTokenCountSchema,
    })
    .optional(),
  outputTokenDetails: z
    .object({
      textTokens: optionalTokenCountSchema,
      reasoningTokens: optionalTokenCountSchema,
    })
    .optional(),
});

/**
 * Read a usage payload from untyped persisted message metadata. Returns
 * undefined when the value is not a valid usage object.
 */
export function harnessUsageFromMetadataValue(
  value: unknown,
): HarnessUsage | undefined {
  const parsed = harnessUsageSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }

  return {
    inputTokens: parsed.data.inputTokens,
    outputTokens: parsed.data.outputTokens,
    totalTokens: parsed.data.totalTokens,
    inputTokenDetails: {
      noCacheTokens: parsed.data.inputTokenDetails?.noCacheTokens,
      cacheReadTokens: parsed.data.inputTokenDetails?.cacheReadTokens,
      cacheWriteTokens: parsed.data.inputTokenDetails?.cacheWriteTokens,
    },
    outputTokenDetails: {
      textTokens: parsed.data.outputTokenDetails?.textTokens,
      reasoningTokens: parsed.data.outputTokenDetails?.reasoningTokens,
    },
    ...(parsed.data.cachedInputTokens !== undefined
      ? { cachedInputTokens: parsed.data.cachedInputTokens }
      : {}),
    ...(parsed.data.reasoningTokens !== undefined
      ? { reasoningTokens: parsed.data.reasoningTokens }
      : {}),
    ...(parsed.data.costUsd !== undefined
      ? { costUsd: parsed.data.costUsd }
      : {}),
  };
}

/**
 * Read the harness-reported cumulative dollar cost from provider metadata,
 * using the registry's per-harness metadata key. Harnesses without a cost
 * metadata key report no cost.
 */
export function extractHarnessCostUsd(
  harnessId: ExternalHarnessId,
  metadata: unknown,
): number | undefined {
  const metadataKey = HARNESS_DEFINITIONS[harnessId].costMetadataKey;
  if (
    metadataKey === undefined ||
    typeof metadata !== "object" ||
    metadata === null
  ) {
    return undefined;
  }

  const harnessMetadata = (metadata as Record<string, unknown>)[metadataKey];
  if (typeof harnessMetadata !== "object" || harnessMetadata === null) {
    return undefined;
  }

  const costUsd = (harnessMetadata as Record<string, unknown>).costUsd;
  return typeof costUsd === "number" && Number.isFinite(costUsd)
    ? costUsd
    : undefined;
}

/** Convert this turn's AI SDK usage into the persisted harness usage shape. */
export function toHarnessUsage(
  usage: LanguageModelUsage,
  harnessId: ExternalHarnessId,
  providerMetadata: unknown,
): HarnessUsage {
  const costUsd = extractHarnessCostUsd(harnessId, providerMetadata);

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.inputTokenDetails.cacheReadTokens,
    reasoningTokens: usage.outputTokenDetails.reasoningTokens,
    inputTokenDetails: {
      noCacheTokens: usage.inputTokenDetails.noCacheTokens,
      cacheReadTokens: usage.inputTokenDetails.cacheReadTokens,
      cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens,
    },
    outputTokenDetails: {
      textTokens: usage.outputTokenDetails.textTokens,
      reasoningTokens: usage.outputTokenDetails.reasoningTokens,
    },
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Enrich the assembled assistant message with model/usage/finish metadata.
 * Continuation turns reuse the assistant message id, so the previous turns'
 * accumulated usage and step history are carried forward, not reset.
 *
 * Message metadata is streamed to the browser and persisted with the message,
 * so the harness's raw finish reason is deliberately left out: unlike a
 * provider's short finish token, it is unsanitized agent-process output that
 * can carry sandbox paths, environment variable names, credentials, and
 * internal URLs. The raw value stays on `HarnessTurnResult`, which the chat
 * workflow logs and persists to `workflow_run_steps.raw_finish_reason`.
 */
export function withHarnessMetadata(
  message: UIMessage,
  input: { selectedModelId: string; modelId: string },
  result: {
    finishReason: FinishReason;
    usage?: HarnessUsage;
  },
): UIMessage {
  const existingMetadata = isRecord(message.metadata)
    ? message.metadata
    : undefined;
  const existingTotalMessageUsage = harnessUsageFromMetadataValue(
    existingMetadata?.totalMessageUsage,
  );
  const existingStepFinishReasons = Array.isArray(
    existingMetadata?.stepFinishReasons,
  )
    ? existingMetadata.stepFinishReasons
    : [];
  const totalMessageUsage =
    result.usage && existingTotalMessageUsage
      ? addHarnessUsage(existingTotalMessageUsage, result.usage)
      : (result.usage ?? existingTotalMessageUsage);

  return {
    ...message,
    metadata: {
      ...existingMetadata,
      selectedModelId: input.selectedModelId,
      modelId: input.modelId,
      ...(result.usage ? { lastStepUsage: result.usage } : {}),
      ...(totalMessageUsage ? { totalMessageUsage } : {}),
      lastStepFinishReason: result.finishReason,
      stepFinishReasons: [
        ...existingStepFinishReasons,
        { finishReason: result.finishReason },
      ],
    },
  };
}
