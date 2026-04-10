import { gateway } from "ai";

export const DEFAULT_MODEL_ID = "anthropic/claude-opus-4.6";
export const DEFAULT_CONTEXT_LIMIT = 200_000;
const TOKENS_PER_MILLION = 1_000_000;

type GatewayAvailableModel = Awaited<
  ReturnType<typeof gateway.getAvailableModels>
>["models"][number];

export interface AvailableModelCost {
  input?: number;
  output?: number;
  cache_read?: number;
}

export type AvailableModel = GatewayAvailableModel & {
  context_window?: number;
  cost?: AvailableModelCost;
};

export function getModelDisplayName(model: AvailableModel): string {
  return model.name ?? model.id;
}

export function getModelContextLimit(
  modelId: string,
  models: AvailableModel[],
): number | undefined {
  const directMatch = models.find((model) => model.id === modelId);
  if (
    typeof directMatch?.context_window !== "number" ||
    directMatch.context_window <= 0
  ) {
    return undefined;
  }

  return directMatch.context_window;
}

export function estimateModelUsageCost(
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  },
  cost: AvailableModelCost | undefined,
): number | undefined {
  const inputPrice = cost?.input;
  const outputPrice = cost?.output;
  if (typeof inputPrice !== "number" || typeof outputPrice !== "number") {
    return undefined;
  }

  const cachedInputTokens = Math.max(0, usage.cachedInputTokens);
  const uncachedInputTokens = Math.max(
    0,
    usage.inputTokens - cachedInputTokens,
  );
  const cacheReadPrice = cost?.cache_read ?? inputPrice;

  return (
    (uncachedInputTokens * inputPrice) / TOKENS_PER_MILLION +
    (cachedInputTokens * cacheReadPrice) / TOKENS_PER_MILLION +
    (Math.max(0, usage.outputTokens) * outputPrice) / TOKENS_PER_MILLION
  );
}
