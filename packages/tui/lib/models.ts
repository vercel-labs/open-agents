import { gateway, type GatewayConfig } from "@open-harness/agent";
import type { GatewayModelId, LanguageModel } from "ai";

export type ModelInfo = {
  id: string;
  name: string;
  description: string;
  pricing?: { input: string; output: string };
  contextLimit?: number;
};

export const AVAILABLE_MODELS: ModelInfo[] = [
  {
    id: "anthropic/claude-opus-4.5",
    name: "Opus 4.5",
    description: "Most capable for complex work",
    pricing: { input: "$15/1M", output: "$75/1M" },
    contextLimit: 200_000,
  },
  {
    id: "anthropic/claude-sonnet-4.5",
    name: "Sonnet 4.5",
    description: "Balanced performance and speed",
    pricing: { input: "$3/1M", output: "$15/1M" },
    contextLimit: 200_000,
  },
  {
    id: "anthropic/claude-haiku-4.5",
    name: "Haiku 4.5",
    description: "Fastest for quick answers",
    pricing: { input: "$0.80/1M", output: "$4/1M" },
    contextLimit: 200_000,
  },
];

/**
 * Get a LanguageModel instance by ID
 */
export function getModelById(
  id: string,
  options: { devtools?: boolean; gatewayConfig?: GatewayConfig } = {},
): LanguageModel {
  return gateway(id as GatewayModelId, {
    devtools: options.devtools,
    config: options.gatewayConfig,
  });
}
