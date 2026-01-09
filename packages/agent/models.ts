import {
  defaultSettingsMiddleware,
  gateway as aiGateway,
  wrapLanguageModel,
  type GatewayModelId,
  type LanguageModel,
} from "ai";
import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import { devToolsMiddleware } from "@ai-sdk/devtools";

type LanguageModelV3 = LanguageModel & { specificationVersion: "v3" };

const anthropicMiddleware = defaultSettingsMiddleware({
  settings: {
    providerOptions: {
      anthropic: {
        thinking: { type: "enabled", budgetTokens: 12000 },
      } satisfies AnthropicProviderOptions,
    },
  },
});

const languageModels = {
  "anthropic/claude-opus-4.5": wrapLanguageModel({
    model: aiGateway("anthropic/claude-opus-4.5"),
    middleware: anthropicMiddleware,
  }),
  "anthropic/claude-sonnet-4.5": wrapLanguageModel({
    model: aiGateway("anthropic/claude-sonnet-4.5"),
    middleware: anthropicMiddleware,
  }),
  "anthropic/claude-haiku-4.5": wrapLanguageModel({
    model: aiGateway("anthropic/claude-haiku-4.5"),
    middleware: anthropicMiddleware,
  }),
};

export function gateway(
  modelId: GatewayModelId,
  { devtools }: { devtools: boolean },
) {
  let model: LanguageModelV3;
  if (modelId in languageModels) {
    model = languageModels[modelId as keyof typeof languageModels];
  } else {
    model = aiGateway(modelId);
  }

  if (devtools) {
    model = wrapLanguageModel({
      model,
      middleware: devToolsMiddleware(),
    });
  }

  return model;
}
