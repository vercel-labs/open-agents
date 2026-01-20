import { gateway } from "ai";
import type { ModelInfo } from "./models";
import { AVAILABLE_MODELS } from "./models";

export type GatewayModel = Awaited<
  ReturnType<typeof gateway.getAvailableModels>
>["models"][number];

/**
 * Format price per token to price per million tokens
 */
function formatPricing(pricePerToken: string): string {
  const price = parseFloat(pricePerToken);
  const pricePerMillion = price * 1_000_000;
  return `$${pricePerMillion.toFixed(2)}/1M`;
}

/**
 * Transform gateway model entry to ModelInfo format
 */
export function transformToModelInfo(model: GatewayModel): ModelInfo {
  return {
    id: model.id,
    name: model.name ?? model.id,
    description: model.description ?? "",
    pricing: model.pricing
      ? {
          input: formatPricing(model.pricing.input),
          output: formatPricing(model.pricing.output),
        }
      : undefined,
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
