import "server-only";

import { gateway } from "ai";
import type { AvailableModel } from "./models";

type GatewayModel = Awaited<
  ReturnType<typeof gateway.getAvailableModels>
>["models"][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getModelsDevContextMap(data: unknown): Map<string, number> {
  const contextMap = new Map<string, number>();
  if (!isRecord(data)) {
    return contextMap;
  }

  for (const [providerKey, providerValue] of Object.entries(data)) {
    if (!isRecord(providerValue)) {
      continue;
    }

    const modelsValue = providerValue.models;
    if (!isRecord(modelsValue)) {
      continue;
    }

    for (const [modelKey, modelValue] of Object.entries(modelsValue)) {
      if (!isRecord(modelValue)) {
        continue;
      }

      const idValue = modelValue.id;
      const rawId = typeof idValue === "string" ? idValue : modelKey;
      const modelId = rawId.includes("/") ? rawId : `${providerKey}/${rawId}`;

      const limitValue = modelValue.limit;
      if (!isRecord(limitValue)) {
        continue;
      }

      const contextValue = limitValue.context;
      if (typeof contextValue !== "number" || contextValue <= 0) {
        continue;
      }

      contextMap.set(modelId, contextValue);
    }
  }

  return contextMap;
}

async function fetchModelsDevContextMap(): Promise<Map<string, number>> {
  try {
    const response = await fetch("https://models.dev/api.json");
    if (!response.ok) {
      return new Map();
    }
    const data: unknown = await response.json();
    return getModelsDevContextMap(data);
  } catch {
    return new Map();
  }
}

function resolveContextLimit(
  modelId: string,
  contextMap: Map<string, number>,
): number | undefined {
  const directMatch = contextMap.get(modelId);
  if (typeof directMatch !== "number" || directMatch <= 0) {
    return undefined;
  }

  return directMatch;
}

function addContextWindow(
  model: GatewayModel,
  contextMap: Map<string, number>,
): AvailableModel {
  const contextLimit = resolveContextLimit(model.id, contextMap);
  if (contextLimit == null) {
    return model;
  }

  const existingContext = Reflect.get(model, "context_window");
  if (existingContext === contextLimit) {
    return model;
  }

  return { ...model, context_window: contextLimit };
}

export async function fetchAvailableLanguageModelsWithContext(): Promise<
  AvailableModel[]
> {
  const [{ models }, modelsDevContextMap] = await Promise.all([
    gateway.getAvailableModels(),
    fetchModelsDevContextMap(),
  ]);

  return models
    .filter((model) => model.modelType === "language")
    .map((model) => addContextWindow(model, modelsDevContextMap));
}
