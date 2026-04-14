import "server-only";

import { gateway } from "ai";
import { filterDisabledModels } from "./model-availability";
import type {
  AvailableModel,
  AvailableModelCost,
  GatewayAvailableModel,
} from "./models";

const MODELS_DEV_URL = "https://models.dev/api.json";
const MODELS_DEV_TIMEOUT_MS = 750;

type GatewayModel = GatewayAvailableModel;

interface ModelsDevMetadata {
  contextWindow?: number;
  cost?: AvailableModelCost;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGatewayModel(value: unknown): value is GatewayModel {
  if (!isRecord(value)) {
    return false;
  }

  const { id, name, description, modelType } = value;

  return (
    typeof id === "string" &&
    typeof name === "string" &&
    (description === undefined ||
      description === null ||
      typeof description === "string") &&
    (modelType === undefined ||
      modelType === null ||
      typeof modelType === "string")
  );
}

function getModelsFromGatewayError(error: unknown): GatewayModel[] | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const response = error.response;
  if (!isRecord(response) || !Array.isArray(response.models)) {
    return undefined;
  }

  const models = response.models.filter(isGatewayModel);
  return models.length > 0 ? models : undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function getModelsDevCostTier(
  value: unknown,
): AvailableModelCost | AvailableModelCost["context_over_200k"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const input = toOptionalNumber(value.input);
  const output = toOptionalNumber(value.output);
  const cacheRead = toOptionalNumber(value.cache_read);

  if (
    typeof input !== "number" &&
    typeof output !== "number" &&
    typeof cacheRead !== "number"
  ) {
    return undefined;
  }

  return {
    input,
    output,
    cache_read: cacheRead,
  };
}

function getModelsDevCost(value: unknown): AvailableModelCost | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const baseCost = getModelsDevCostTier(value);
  const contextOver200k = getModelsDevCostTier(value.context_over_200k);

  if (!baseCost && !contextOver200k) {
    return undefined;
  }

  return {
    ...baseCost,
    ...(contextOver200k ? { context_over_200k: contextOver200k } : {}),
  };
}

function getModelsDevMetadataMap(
  data: unknown,
): Map<string, ModelsDevMetadata> {
  const metadataMap = new Map<string, ModelsDevMetadata>();
  if (!isRecord(data)) {
    return metadataMap;
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
      const contextWindow = isRecord(limitValue)
        ? toOptionalNumber(limitValue.context)
        : undefined;
      const cost = getModelsDevCost(modelValue.cost);

      if (
        (typeof contextWindow !== "number" || contextWindow <= 0) &&
        cost === undefined
      ) {
        continue;
      }

      metadataMap.set(modelId, {
        contextWindow:
          typeof contextWindow === "number" && contextWindow > 0
            ? contextWindow
            : undefined,
        cost,
      });
    }
  }

  return metadataMap;
}

async function fetchModelsDevMetadataMap(): Promise<
  Map<string, ModelsDevMetadata>
> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MODELS_DEV_TIMEOUT_MS);

  try {
    const response = await fetch(MODELS_DEV_URL, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return new Map();
    }
    const data: unknown = await response.json();
    return getModelsDevMetadataMap(data);
  } catch {
    return new Map();
  } finally {
    clearTimeout(timeoutId);
  }
}

function addModelsDevMetadata(
  model: GatewayModel,
  metadataMap: Map<string, ModelsDevMetadata>,
): AvailableModel {
  const metadata = metadataMap.get(model.id);
  if (!metadata) {
    return model;
  }

  const nextModel: AvailableModel = { ...model };

  if (
    typeof metadata.contextWindow === "number" &&
    metadata.contextWindow > 0
  ) {
    nextModel.context_window = metadata.contextWindow;
  }

  if (metadata.cost) {
    nextModel.cost = metadata.cost;
  }

  return nextModel;
}

async function fetchGatewayModels(): Promise<GatewayModel[]> {
  try {
    const { models } = await gateway.getAvailableModels();
    return models;
  } catch (error) {
    const models = getModelsFromGatewayError(error);
    if (models) {
      return models;
    }

    throw error;
  }
}

export async function fetchAvailableLanguageModels(): Promise<
  AvailableModel[]
> {
  const models = await fetchGatewayModels();
  return filterDisabledModels(
    models.filter((model) => model.modelType === "language"),
  );
}

export async function fetchAvailableLanguageModelsWithContext(): Promise<
  AvailableModel[]
> {
  const [models, modelsDevMetadataMap] = await Promise.all([
    fetchAvailableLanguageModels(),
    fetchModelsDevMetadataMap(),
  ]);

  return models.map((model) =>
    addModelsDevMetadata(model, modelsDevMetadataMap),
  );
}
