import { gateway } from "ai";

export const DEFAULT_MODEL_ID = "anthropic/claude-haiku-4.5";
export const DEFAULT_CONTEXT_LIMIT = 200_000;

type GatewayAvailableModel = Awaited<
  ReturnType<typeof gateway.getAvailableModels>
>["models"][number];

export type AvailableModel = GatewayAvailableModel & {
  context_window?: number;
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
    typeof directMatch?.context_window === "number" &&
    directMatch.context_window > 0
  ) {
    return directMatch.context_window;
  }

  const normalizedModelId = modelId.toLowerCase();
  let bestMatch: { contextLimit: number; matchLength: number } | undefined;

  for (const model of models) {
    if (typeof model.context_window !== "number" || model.context_window <= 0) {
      continue;
    }

    const normalizedAvailableModelId = model.id.toLowerCase();
    const isRelatedMatch =
      normalizedModelId.includes(normalizedAvailableModelId) ||
      normalizedAvailableModelId.includes(normalizedModelId);

    if (!isRelatedMatch) {
      continue;
    }

    const matchLength = Math.min(
      normalizedModelId.length,
      normalizedAvailableModelId.length,
    );

    if (!bestMatch || matchLength > bestMatch.matchLength) {
      bestMatch = { contextLimit: model.context_window, matchLength };
    }
  }

  return bestMatch?.contextLimit;
}
