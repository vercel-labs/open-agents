import { MODEL_CONTEXT_LIMITS } from "@open-harness/agent";
import type { ModelInfo } from "./models";
import { AVAILABLE_MODELS } from "./models";

export type GatewayModel = {
  id: string;
  name?: string | null;
  description?: string | null;
  pricing?: {
    input: string;
    output: string;
  } | null;
  modelType?: "language" | "embedding" | "image" | null;
  type?: "language" | "embedding" | "image" | null;
  context_window?: number | null;
};

type GatewayModelsResponse = {
  models: GatewayModel[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGatewayModel(value: unknown): value is GatewayModel {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.id === "string";
}

function isGatewayModelsResponse(
  value: unknown,
): value is GatewayModelsResponse {
  if (!isRecord(value)) {
    return false;
  }
  const { models } = value;
  return Array.isArray(models) && models.every(isGatewayModel);
}

/**
 * Format price per token to price per million tokens
 */
function formatPricing(pricePerToken: string): string | undefined {
  const price = parseFloat(pricePerToken);
  if (Number.isNaN(price)) {
    return undefined;
  }
  const pricePerMillion = price * 1_000_000;
  return `$${pricePerMillion.toFixed(2)}/1M`;
}

function getKnownContextLimit(modelId: string): number | undefined {
  const directMatch = MODEL_CONTEXT_LIMITS[modelId];
  if (directMatch) {
    return directMatch;
  }

  const normalizedModelId = modelId.toLowerCase();
  for (const [key, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (normalizedModelId.includes(key.toLowerCase())) {
      return limit;
    }
  }

  return undefined;
}

/**
 * Transform gateway model entry to ModelInfo format
 */
export function transformToModelInfo(model: GatewayModel): ModelInfo {
  let pricing: ModelInfo["pricing"];
  if (model.pricing) {
    const input = formatPricing(model.pricing.input);
    const output = formatPricing(model.pricing.output);
    if (input && output) {
      pricing = { input, output };
    }
  }

  const contextLimit =
    typeof model.context_window === "number" && model.context_window > 0
      ? model.context_window
      : getKnownContextLimit(model.id);

  return {
    id: model.id,
    name: model.name ?? model.id,
    description: model.description ?? "",
    pricing,
    contextLimit,
  };
}

/**
 * Fetch available models from the gateway provider.
 * Falls back to hardcoded models on failure.
 */
export async function fetchAvailableModels(options?: {
  baseUrl?: string;
}): Promise<ModelInfo[]> {
  try {
    const baseUrl = options?.baseUrl ?? "";
    const url = `${baseUrl}/api/models`;
    const response = await fetch(url, {
      headers: {
        "Accept-Encoding": "identity",
      },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch models (${response.status})`);
    }
    const data: unknown = await response.json();
    if (!isGatewayModelsResponse(data)) {
      throw new Error("Invalid models response");
    }

    // Filter to only language models (not embeddings/image models)
    const languageModels = data.models.filter((model) => {
      const modelType = model.modelType ?? model.type;
      return !modelType || modelType === "language";
    });

    if (languageModels.length === 0) {
      return AVAILABLE_MODELS;
    }

    return languageModels.map(transformToModelInfo);
  } catch {
    // Return fallback models on any error
    return AVAILABLE_MODELS;
  }
}
