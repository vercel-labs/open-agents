export const DEFAULT_MODEL_ID = "anthropic/claude-opus-4.6";
export const DEFAULT_CONTEXT_LIMIT = 200_000;
const TOKENS_PER_MILLION = 1_000_000;

export interface GatewayAvailableModel {
  id: string;
  name: string;
  description?: string | null;
  modelType?: string | null;
}

export interface AvailableModelCostTier {
  input?: number;
  output?: number;
  cache_read?: number;
}

export interface AvailableModelCost extends AvailableModelCostTier {
  context_over_200k?: AvailableModelCostTier;
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

function resolveCostTier(
  usage: { inputTokens: number },
  cost: AvailableModelCost | undefined,
): AvailableModelCostTier | undefined {
  if (!cost) {
    return undefined;
  }

  if (
    usage.inputTokens > 200_000 &&
    (typeof cost.context_over_200k?.input === "number" ||
      typeof cost.context_over_200k?.output === "number")
  ) {
    return {
      input: cost.context_over_200k.input ?? cost.input,
      output: cost.context_over_200k.output ?? cost.output,
      cache_read: cost.context_over_200k.cache_read ?? cost.cache_read,
    };
  }

  return cost;
}

export function estimateModelUsageCost(
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  },
  cost: AvailableModelCost | undefined,
): number | undefined {
  const costTier = resolveCostTier(usage, cost);
  const inputPrice = costTier?.input;
  const outputPrice = costTier?.output;
  if (typeof inputPrice !== "number" || typeof outputPrice !== "number") {
    return undefined;
  }

  const cachedInputTokens = Math.max(0, usage.cachedInputTokens);
  const uncachedInputTokens = Math.max(
    0,
    usage.inputTokens - cachedInputTokens,
  );
  const cacheReadPrice = costTier?.cache_read ?? inputPrice;

  return (
    (uncachedInputTokens * inputPrice) / TOKENS_PER_MILLION +
    (cachedInputTokens * cacheReadPrice) / TOKENS_PER_MILLION +
    (Math.max(0, usage.outputTokens) * outputPrice) / TOKENS_PER_MILLION
  );
}
