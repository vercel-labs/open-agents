import { gateway } from "ai";
import type { ModelInfo } from "./models";
import { AVAILABLE_MODELS } from "./models";

export type GatewayModel = Awaited<
  ReturnType<typeof gateway.getAvailableModels>
>["models"][number];

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

  return {
    id: model.id,
    name: model.name ?? model.id,
    description: model.description ?? "",
    pricing,
  };
}

/**
 * Fetch available models from the gateway provider.
 * Falls back to hardcoded models on failure.
 */
export async function fetchAvailableModels(): Promise<ModelInfo[]> {
  try {
    const response = await gateway.getAvailableModels();

    // Filter to only language models (not embeddings/image models)
    const languageModels = response.models.filter(
      (m) => !m.modelType || m.modelType === "language",
    );

    if (languageModels.length === 0) {
      return AVAILABLE_MODELS;
    }

    return languageModels.map(transformToModelInfo);
  } catch {
    // Return fallback models on any error
    return AVAILABLE_MODELS;
  }
}
