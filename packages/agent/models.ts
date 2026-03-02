import type { AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import { devToolsMiddleware } from "@ai-sdk/devtools";
import {
  createGateway,
  defaultSettingsMiddleware,
  gateway as aiGateway,
  wrapLanguageModel,
  type GatewayModelId,
  type JSONValue,
  type LanguageModel,
} from "ai";

type ProviderOptionsByProvider = Record<string, Record<string, JSONValue>>;

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

function hasProviderOptions(
  providerOptions: ProviderOptionsByProvider,
): boolean {
  return Object.keys(providerOptions).length > 0;
}

function mergeProviderOptions(
  defaults: ProviderOptionsByProvider,
  overrides?: ProviderOptionsByProvider,
): ProviderOptionsByProvider {
  if (!overrides) {
    return defaults;
  }

  const merged: ProviderOptionsByProvider = { ...defaults };

  for (const [provider, providerSettings] of Object.entries(overrides)) {
    if (provider in merged) {
      merged[provider] = {
        ...merged[provider],
        ...providerSettings,
      };
      continue;
    }

    merged[provider] = providerSettings;
  }

  return merged;
}

export interface GatewayConfig {
  baseURL: string;
  apiKey: string;
}

export interface GatewayOptions {
  devtools?: boolean;
  config?: GatewayConfig;
  providerOptionsOverrides?: ProviderOptionsByProvider;
}

export function gateway(
  modelId: GatewayModelId,
  options: GatewayOptions = {},
): LanguageModel {
  const { devtools = false, config, providerOptionsOverrides } = options;

  // Use custom gateway config or default AI SDK gateway
  const baseGateway = config
    ? createGateway({ baseURL: config.baseURL, apiKey: config.apiKey })
    : aiGateway;

  let model: LanguageModel = baseGateway(modelId);

  const defaultProviderOptions: ProviderOptionsByProvider = {};

  // Apply anthropic middleware for anthropic models
  if (modelId.startsWith("anthropic/")) {
    defaultProviderOptions.anthropic = getAnthropicSettings(modelId) as Record<
      string,
      JSONValue
    >;
  }

  // Apply openai middleware to expose reasoning summaries
  if (modelId.startsWith("openai/")) {
    defaultProviderOptions.openai = {
      reasoningEffort: "high",
      reasoningSummary: "detailed",
    };
  }

  const providerOptions = mergeProviderOptions(
    defaultProviderOptions,
    providerOptionsOverrides,
  );

  if (hasProviderOptions(providerOptions)) {
    const middleware = defaultSettingsMiddleware({
      settings: {
        providerOptions,
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
