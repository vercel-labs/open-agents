import { APP_DEFAULT_MODEL_ID } from "@/lib/models";

const DISABLED_MODEL_IDS = new Set(["openai/gpt-5.4-pro"]);

export function isModelDisabled(modelId: string): boolean {
  return DISABLED_MODEL_IDS.has(modelId);
}

export function filterDisabledModels<T extends { id: string }>(
  models: T[],
): T[] {
  return models.filter((model) => !isModelDisabled(model.id));
}

export function resolveAvailableModelId(modelId: string): string {
  if (isModelDisabled(modelId)) {
    return APP_DEFAULT_MODEL_ID;
  }

  return modelId;
}
