import { gateway } from "@open-harness/agent";
import type { GatewayModelId, LanguageModel } from "ai";
import type { WebAgentUIMessage } from "@/app/types";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { resolveModelSelection } from "@/lib/model-variants";
import { DEFAULT_CONTEXT_LIMIT, DEFAULT_MODEL_ID } from "@/lib/models";
import type { ChatCompactionContextPayload } from "./types";

export type ChatUserPreferences = Awaited<
  ReturnType<typeof getUserPreferences>
> | null;

export interface ChatCompactionContext {
  contextLimit: number;
  lastInputTokens?: number;
}

export interface ResolvedChatModelContext {
  preferences: ChatUserPreferences;
  model: LanguageModel | string;
  subagentModel: LanguageModel | undefined;
  compactionContext: ChatCompactionContext;
}

function toPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function toPositiveInputTokens(value: unknown): number | undefined {
  const normalized = toPositiveInteger(value);
  return normalized && normalized > 0 ? normalized : undefined;
}

function extractLastInputTokensFromMessages(
  messages: WebAgentUIMessage[],
): number | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant") {
      continue;
    }

    const metadata = (message as { metadata?: unknown }).metadata;
    if (!metadata || typeof metadata !== "object") {
      continue;
    }

    const lastStepUsage = (metadata as { lastStepUsage?: unknown })
      .lastStepUsage;
    if (!lastStepUsage || typeof lastStepUsage !== "object") {
      continue;
    }

    const inputTokens = (lastStepUsage as { inputTokens?: unknown })
      .inputTokens;
    const normalizedTokens = toPositiveInputTokens(inputTokens);
    if (normalizedTokens) {
      return normalizedTokens;
    }
  }

  return undefined;
}

export async function resolveChatModelContext(params: {
  userId: string;
  chatModelId: string | null;
  messages: WebAgentUIMessage[];
  requestedCompactionContext?: ChatCompactionContextPayload;
}): Promise<ResolvedChatModelContext> {
  const { userId, chatModelId, messages, requestedCompactionContext } = params;

  const preferences = await getUserPreferences(userId).catch((error) => {
    console.error("Failed to load user preferences:", error);
    return null;
  });

  const modelVariants = preferences?.modelVariants ?? [];
  const selectedModelId = chatModelId ?? DEFAULT_MODEL_ID;
  const mainSelection = resolveModelSelection(selectedModelId, modelVariants);

  if (mainSelection.isMissingVariant) {
    console.warn(
      `Selected model variant "${selectedModelId}" was not found. Falling back to default model.`,
    );
  }

  const mainResolvedModelId = mainSelection.isMissingVariant
    ? DEFAULT_MODEL_ID
    : mainSelection.resolvedModelId;

  let model: LanguageModel | string;
  try {
    model = gateway(mainResolvedModelId as GatewayModelId, {
      providerOptionsOverrides: mainSelection.isMissingVariant
        ? undefined
        : mainSelection.providerOptionsByProvider,
    });
  } catch (error) {
    console.error(
      `Invalid model ID "${mainResolvedModelId}", falling back to default:`,
      error,
    );
    model = gateway(DEFAULT_MODEL_ID as GatewayModelId);
  }

  let subagentModel: LanguageModel | undefined;

  if (preferences?.defaultSubagentModelId) {
    const subagentSelection = resolveModelSelection(
      preferences.defaultSubagentModelId,
      modelVariants,
    );

    if (subagentSelection.isMissingVariant) {
      console.warn(
        `Subagent model variant "${preferences.defaultSubagentModelId}" was not found. Falling back to default model.`,
      );
    }

    const subagentResolvedModelId = subagentSelection.isMissingVariant
      ? DEFAULT_MODEL_ID
      : subagentSelection.resolvedModelId;

    try {
      subagentModel = gateway(subagentResolvedModelId as GatewayModelId, {
        providerOptionsOverrides: subagentSelection.isMissingVariant
          ? undefined
          : subagentSelection.providerOptionsByProvider,
      });
    } catch (error) {
      console.error("Failed to resolve subagent model preference:", error);
    }
  }

  const requestedContextLimit = toPositiveInteger(
    requestedCompactionContext?.contextLimit,
  );

  const requestedLastInputTokens = toPositiveInputTokens(
    requestedCompactionContext?.lastInputTokens,
  );

  const inferredLastInputTokens = extractLastInputTokensFromMessages(messages);

  const compactionContext: ChatCompactionContext = {
    contextLimit: requestedContextLimit ?? DEFAULT_CONTEXT_LIMIT,
    lastInputTokens: requestedLastInputTokens ?? inferredLastInputTokens,
  };

  return {
    preferences,
    model,
    subagentModel,
    compactionContext,
  };
}
