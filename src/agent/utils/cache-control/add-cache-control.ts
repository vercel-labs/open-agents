import type { ModelMessage, JSONValue, LanguageModel, ToolSet } from "ai";
import { isAnthropicModel, DEFAULT_CACHE_CONTROL_OPTIONS } from "./shared";

type ProviderOptions = Record<string, Record<string, JSONValue>>;

/**
 * Adds provider-specific cache control options to tools for optimal caching.
 *
 * For Anthropic: marks all tools with `cacheControl: { type: "ephemeral" }`.
 * For non-Anthropic models, tools are returned unchanged.
 *
 * @example
 * ```ts
 * const result = await generateText({
 *   model: anthropic('claude-3-5-haiku-latest'),
 *   tools: addCacheControl({
 *     tools: {
 *       cityAttractions: tool({
 *         parameters: z.object({ city: z.string() }),
 *         execute: async ({ city }) => `Attractions in ${city}`,
 *       }),
 *     },
 *     model,
 *   }),
 *   messages: [...],
 * });
 * ```
 */
export function addCacheControl<T extends ToolSet>(options: {
  tools: T;
  model: LanguageModel;
  providerOptions?: ProviderOptions;
}): T;

/**
 * Adds provider-specific cache control options to messages for optimal caching.
 *
 * For Anthropic: marks the last message with `cacheControl: { type: "ephemeral" }`
 * per their docs - "Mark the final block of the final message with cache_control
 * so the conversation can be incrementally cached."
 *
 * For non-Anthropic models, messages are returned unchanged.
 *
 * @example
 * ```ts
 * prepareStep: ({ messages, model, ...rest }) => ({
 *   ...rest,
 *   messages: addCacheControl({ messages, model }),
 * }),
 * ```
 */
export function addCacheControl(options: {
  messages: ModelMessage[];
  model: LanguageModel;
  providerOptions?: ProviderOptions;
}): ModelMessage[];

export function addCacheControl<T extends ToolSet>({
  tools,
  messages,
  model,
  providerOptions = DEFAULT_CACHE_CONTROL_OPTIONS,
}: {
  tools?: T;
  messages?: ModelMessage[];
  model: LanguageModel;
  providerOptions?: ProviderOptions;
}): T | ModelMessage[] {
  if (!isAnthropicModel(model)) {
    return (tools ?? messages)!;
  }

  if (tools !== undefined) {
    const entries = Object.entries(tools);
    if (entries.length === 0) return tools;

    // Anthropic supports max 4 cache breakpoints - only mark the last tool
    // to avoid exceeding the limit when combined with message caching
    const lastIndex = entries.length - 1;
    return Object.fromEntries(
      entries.map(([name, tool], index) => [
        name,
        index === lastIndex
          ? {
              ...tool,
              providerOptions: {
                ...tool.providerOptions,
                ...providerOptions,
              },
            }
          : tool,
      ]),
    ) as T;
  }

  if (messages !== undefined) {
    if (messages.length === 0) return messages;
    return messages.map((message, index) =>
      index === messages.length - 1
        ? {
            ...message,
            providerOptions: {
              ...message.providerOptions,
              ...providerOptions,
            },
          }
        : message,
    );
  }

  throw new Error("Either tools or messages must be provided");
}
