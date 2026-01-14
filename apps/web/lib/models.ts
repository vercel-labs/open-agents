import { gateway } from "ai";

export const DEFAULT_MODEL_ID = "anthropic/claude-haiku-4.5";

export type AvailableModel = Awaited<
  ReturnType<typeof gateway.getAvailableModels>
>["models"][number];

// Cache available models to avoid repeated API calls
let cachedModels: AvailableModel[] | null = null;

export async function getAvailableModels(): Promise<AvailableModel[]> {
  if (!cachedModels) {
    const response = await gateway.getAvailableModels();
    cachedModels = response.models;
  }
  return cachedModels;
}

export function isValidModelId(
  modelId: string,
  models: AvailableModel[],
): boolean {
  return models.some((m) => m.id === modelId);
}

export function getModelDisplayName(model: AvailableModel): string {
  return model.name ?? model.id;
}
