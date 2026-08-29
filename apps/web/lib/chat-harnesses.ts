import { EXTERNAL_HARNESS_IDS } from "@open-agents/harness-runner/ids";
import { APP_DEFAULT_MODEL_ID, DEFAULT_MODEL_ID } from "@/lib/models";

/**
 * Derived from the harness runner's id list so the web registry cannot drift
 * from the harnesses the runner actually supports. Stays a readonly literal
 * tuple ("open-agent" + the external ids) so it remains usable as a drizzle
 * `enum` config.
 */
export const CHAT_HARNESS_IDS = [
  "open-agent",
  ...EXTERNAL_HARNESS_IDS,
] as const;

export type ChatHarnessId = (typeof CHAT_HARNESS_IDS)[number];

export const DEFAULT_CHAT_HARNESS_ID: ChatHarnessId = "open-agent";

export type HarnessPreferredModelProvider = "anthropic" | "openai";

type ChatHarnessBase = {
  label: string;
  description: string;
};

/**
 * Harnesses either run on a single native provider (which drives the harness
 * icon, the preferred-model warnings, and the fallback model substituted when
 * a non-native model is selected) or accept any model.
 */
export type ChatHarnessDefinition =
  | (ChatHarnessBase & {
      provider: HarnessPreferredModelProvider;
      defaultModelId: string;
    })
  | (ChatHarnessBase & { provider?: undefined; defaultModelId?: undefined });

const CHAT_HARNESSES: Record<ChatHarnessId, ChatHarnessDefinition> = {
  "open-agent": {
    label: "Open Agent",
    description: "Durable Open Agents tool loop",
  },
  codex: {
    label: "Codex",
    description: "Codex native coding agent",
    provider: "openai",
    defaultModelId: APP_DEFAULT_MODEL_ID,
  },
  "claude-code": {
    label: "Claude Code",
    description: "Claude Code native coding agent",
    provider: "anthropic",
    defaultModelId: DEFAULT_MODEL_ID,
  },
  pi: {
    label: "Pi",
    description: "Pi coding agent",
  },
};

// The default model constants live in lib/models and can be repointed at any
// provider; fail loudly at module init if a harness default stops matching
// its native provider instead of silently mis-attributing usage.
for (const [id, definition] of Object.entries(CHAT_HARNESSES)) {
  if (
    definition.provider &&
    !definition.defaultModelId.startsWith(`${definition.provider}/`)
  ) {
    throw new Error(
      `Chat harness "${id}" default model "${definition.defaultModelId}" is not a "${definition.provider}" model`,
    );
  }
}

export function getChatHarnessDefinition(
  id: ChatHarnessId,
): ChatHarnessDefinition {
  return CHAT_HARNESSES[id];
}

export type ChatHarnessOption = {
  id: ChatHarnessId;
  label: string;
  description: string;
};

export const CHAT_HARNESS_OPTIONS: ChatHarnessOption[] = CHAT_HARNESS_IDS.map(
  (id) => ({
    id,
    label: CHAT_HARNESSES[id].label,
    description: CHAT_HARNESSES[id].description,
  }),
);

export const CHAT_HARNESS_PREFERRED_MODEL_PROVIDERS: Partial<
  Record<ChatHarnessId, HarnessPreferredModelProvider>
> = Object.fromEntries(
  CHAT_HARNESS_IDS.flatMap((id) => {
    const { provider } = CHAT_HARNESSES[id];
    return provider ? [[id, provider] as const] : [];
  }),
);

export function getChatHarnessLabel(id: ChatHarnessId): string {
  return CHAT_HARNESSES[id].label;
}

export function getPreferredModelProviderForHarness(
  id: ChatHarnessId,
): HarnessPreferredModelProvider | undefined {
  return CHAT_HARNESSES[id].provider;
}

export function isPreferredModelProviderForHarness(
  id: ChatHarnessId,
  provider: string,
): boolean {
  const preferredProvider = getPreferredModelProviderForHarness(id);
  return preferredProvider === undefined || provider === preferredProvider;
}

/**
 * Resolve the model a harness will actually run. Codex and Claude Code can
 * only run models from their native provider; any other selection silently
 * falls back inside the harness, so substitute an explicit default here to
 * keep message metadata and usage attribution truthful.
 */
export function resolveHarnessRunModelId(
  id: ChatHarnessId,
  modelId: string,
): string {
  const definition = CHAT_HARNESSES[id];
  if (!definition.provider) {
    return modelId;
  }

  return modelId.startsWith(`${definition.provider}/`)
    ? modelId
    : definition.defaultModelId;
}

export function isChatHarnessId(value: unknown): value is ChatHarnessId {
  return (
    typeof value === "string" &&
    CHAT_HARNESS_IDS.includes(value as ChatHarnessId)
  );
}
