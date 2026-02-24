import {
  createGateway,
  defaultSettingsMiddleware,
  gateway as aiGateway,
  wrapLanguageModel,
  type GatewayModelId,
  type LanguageModel,
} from "ai";
import type { AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import { devToolsMiddleware } from "@ai-sdk/devtools";

// Models with 4.5+ support adaptive thinking with effort control.
// Older models use the legacy extended thinking API with a budget.
function getAnthropicSettings(modelId: string): AnthropicLanguageModelOptions {
  if (modelId.includes("4.6")) {
    return {
      effort: "medium",
      thinking: { type: "adaptive" },
    };
  }

  return {
    thinking: { type: "enabled", budgetTokens: 8000 },
  };
}

export interface GatewayConfig {
  baseURL: string;
  apiKey: string;
}

export interface GatewayOptions {
  devtools?: boolean;
  config?: GatewayConfig;
}

export function gateway(
  modelId: GatewayModelId,
  options: GatewayOptions = {},
): LanguageModel {
  const { devtools = false, config } = options;

  // Use custom gateway config or default AI SDK gateway
  const baseGateway = config
    ? createGateway({ baseURL: config.baseURL, apiKey: config.apiKey })
    : aiGateway;

  let model: LanguageModel = baseGateway(modelId);

  // Apply anthropic middleware for anthropic models
  if (modelId.startsWith("anthropic/")) {
    const middleware = defaultSettingsMiddleware({
      settings: {
        providerOptions: {
          anthropic: getAnthropicSettings(modelId),
        },
      },
    });
    model = wrapLanguageModel({ model, middleware });
  }

  // Apply openai middleware to expose reasoning summaries
  if (modelId.startsWith("openai/")) {
    const middleware = defaultSettingsMiddleware({
      settings: {
        providerOptions: {
          openai: {
            reasoningEffort: "high",
            reasoningSummary: "detailed",
          },
        },
      },
    });
    model = wrapLanguageModel({ model, middleware });
  }

  // Apply devtools middleware if requested
  if (devtools) {
    model = wrapLanguageModel({ model, middleware: devToolsMiddleware() });
  }

  return model;
}
