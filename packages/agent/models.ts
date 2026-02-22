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

const anthropicMiddleware = defaultSettingsMiddleware({
  settings: {
    providerOptions: {
      anthropic: {
        effort: "medium",
      } satisfies AnthropicLanguageModelOptions,
    },
  },
});

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
    model = wrapLanguageModel({ model, middleware: anthropicMiddleware });
  }

  // Apply devtools middleware if requested
  if (devtools) {
    model = wrapLanguageModel({ model, middleware: devToolsMiddleware() });
  }

  return model;
}
