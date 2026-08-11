import { APP_DEFAULT_MODEL_ID, DEFAULT_MODEL_ID } from "@/lib/models";

export const CHAT_HARNESS_IDS = [
  "open-agent",
  "codex",
  "claude-code",
  "pi",
] as const;

export type ChatHarnessId = (typeof CHAT_HARNESS_IDS)[number];

export const DEFAULT_CHAT_HARNESS_ID: ChatHarnessId = "open-agent";

export type HarnessPreferredModelProvider = "anthropic" | "openai";

const CHAT_HARNESS_PREFERRED_MODEL_PROVIDERS: Partial<
  Record<ChatHarnessId, HarnessPreferredModelProvider>
> = {
  codex: "openai",
  "claude-code": "anthropic",
};

export type ChatHarnessOption = {
  id: ChatHarnessId;
  label: string;
  description: string;
  available: boolean;
};

export const CHAT_HARNESS_OPTIONS: ChatHarnessOption[] = [
  {
    id: "open-agent",
    label: "Open Agent",
    description: "Durable Open Agents tool loop",
    available: true,
  },
  {
    id: "codex",
    label: "Codex",
    description: "Codex native coding agent",
    available: true,
  },
  {
    id: "claude-code",
    label: "Claude Code",
    description: "Claude Code native coding agent",
    available: true,
  },
  {
    id: "pi",
    label: "Pi",
    description: "Pi coding agent",
    available: true,
  },
];

export function getChatHarnessLabel(id: ChatHarnessId): string {
  return CHAT_HARNESS_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

export function getPreferredModelProviderForHarness(
  id: ChatHarnessId,
): HarnessPreferredModelProvider | undefined {
  return CHAT_HARNESS_PREFERRED_MODEL_PROVIDERS[id];
}

export function isPreferredModelProviderForHarness(
  id: ChatHarnessId,
  provider: string,
): boolean {
  const preferredProvider = getPreferredModelProviderForHarness(id);
  return preferredProvider === undefined || provider === preferredProvider;
}

const CHAT_HARNESS_DEFAULT_MODEL_IDS: Record<
  HarnessPreferredModelProvider,
  string
> = {
  openai: APP_DEFAULT_MODEL_ID,
  anthropic: DEFAULT_MODEL_ID,
};

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
  const preferredProvider = getPreferredModelProviderForHarness(id);
  if (!preferredProvider) {
    return modelId;
  }

  return modelId.startsWith(`${preferredProvider}/`)
    ? modelId
    : CHAT_HARNESS_DEFAULT_MODEL_IDS[preferredProvider];
}

export function isChatHarnessId(value: unknown): value is ChatHarnessId {
  return (
    typeof value === "string" &&
    CHAT_HARNESS_IDS.includes(value as ChatHarnessId)
  );
}

export function isAvailableChatHarnessId(
  value: unknown,
): value is ChatHarnessId {
  return (
    isChatHarnessId(value) &&
    CHAT_HARNESS_OPTIONS.some(
      (option) => option.id === value && option.available,
    )
  );
}
