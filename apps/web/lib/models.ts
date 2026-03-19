import { gateway } from "ai";

export const DEFAULT_MODEL_ID = "anthropic/claude-opus-4.6";
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
    typeof directMatch?.context_window !== "number" ||
    directMatch.context_window <= 0
  ) {
    return undefined;
  }

  return directMatch.context_window;
}
