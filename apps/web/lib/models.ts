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
  const partialMatch = models.find((model) => {
    const normalizedAvailableModelId = model.id.toLowerCase();
    return (
      normalizedModelId.includes(normalizedAvailableModelId) ||
      normalizedAvailableModelId.includes(normalizedModelId)
    );
  });

  if (
    typeof partialMatch?.context_window === "number" &&
    partialMatch.context_window > 0
  ) {
    return partialMatch.context_window;
  }

  return undefined;
}
