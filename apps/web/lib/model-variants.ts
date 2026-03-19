import { z } from "zod";

export const MODEL_VARIANT_ID_PREFIX = "variant:";
export const BUILT_IN_VARIANT_ID_PREFIX = "variant:builtin:";
const MODEL_VARIANT_NAME_MAX_LENGTH = 80;

type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const modelVariantIdSchema = z
  .string()
  .trim()
  .min(1)
  .startsWith(MODEL_VARIANT_ID_PREFIX);

const modelVariantNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MODEL_VARIANT_NAME_MAX_LENGTH);

const baseModelIdSchema = z.string().trim().min(1);

export const providerOptionsSchema = z.record(z.string(), jsonValueSchema);

export const modelVariantSchema = z.object({
  id: modelVariantIdSchema,
  name: modelVariantNameSchema,
  baseModelId: baseModelIdSchema,
  providerOptions: providerOptionsSchema,
});

export const modelVariantsSchema = z.array(modelVariantSchema);

export type ModelVariant = z.infer<typeof modelVariantSchema>;

export const createModelVariantInputSchema = z.object({
  name: modelVariantNameSchema,
  baseModelId: baseModelIdSchema,
  providerOptions: providerOptionsSchema.default({}),
});

export const updateModelVariantInputSchema = z
  .object({
    id: modelVariantIdSchema,
    name: modelVariantNameSchema.optional(),
    baseModelId: baseModelIdSchema.optional(),
    providerOptions: providerOptionsSchema.optional(),
  })
  .refine(
    (input) =>
      input.name !== undefined ||
      input.baseModelId !== undefined ||
      input.providerOptions !== undefined,
    {
      message: "At least one field to update is required",
      path: ["id"],
    },
  );

export const deleteModelVariantInputSchema = z.object({
  id: modelVariantIdSchema,
});

export type ProviderOptionsByProvider = Record<
  string,
  Record<string, JsonValue>
>;

function withVariantProviderDefaults(
  provider: string,
  providerOptions: Record<string, JsonValue>,
): Record<string, JsonValue> {
  if (provider !== "openai") {
    return providerOptions;
  }

  // OpenAI Responses items are not persisted when store is false. Ensure
  // variants always carry the non-persistent setting so follow-up turns never
  // try to reference missing rs_* items.
  return {
    ...providerOptions,
    store: false,
  };
}

export function toProviderOptionsByProvider(
  baseModelId: string,
  providerOptions: Record<string, JsonValue>,
): ProviderOptionsByProvider | undefined {
  const provider = baseModelId.split("/")[0];
  if (!provider) {
    return undefined;
  }

  const providerOptionsWithDefaults = withVariantProviderDefaults(
    provider,
    providerOptions,
  );
  if (Object.keys(providerOptionsWithDefaults).length === 0) {
    return undefined;
  }

  return {
    [provider]: providerOptionsWithDefaults,
  };
}

export interface ResolvedModelSelection {
  resolvedModelId: string;
  providerOptionsByProvider?: ProviderOptionsByProvider;
  isMissingVariant: boolean;
}

export function resolveModelSelection(
  selectedModelId: string,
  variants: ModelVariant[],
): ResolvedModelSelection {
  if (!selectedModelId.startsWith(MODEL_VARIANT_ID_PREFIX)) {
    return {
      resolvedModelId: selectedModelId,
      isMissingVariant: false,
    };
  }

  const variant = variants.find((item) => item.id === selectedModelId);
  if (!variant) {
    return {
      resolvedModelId: selectedModelId,
      isMissingVariant: true,
    };
  }

  return {
    resolvedModelId: variant.baseModelId,
    providerOptionsByProvider: toProviderOptionsByProvider(
      variant.baseModelId,
      variant.providerOptions,
    ),
    isMissingVariant: false,
  };
}

export function isBuiltInVariant(variantId: string): boolean {
  return variantId.startsWith(BUILT_IN_VARIANT_ID_PREFIX);
}

export const BUILT_IN_VARIANTS: ModelVariant[] = [
  {
    id: `${BUILT_IN_VARIANT_ID_PREFIX}gpt-5.4-xhigh`,
    name: "GPT-5.4 (XHigh)",
    baseModelId: "openai/gpt-5.4",
    providerOptions: {
      reasoningEffort: "xhigh",
      reasoningSummary: "auto",
    },
  },
  {
    id: `${BUILT_IN_VARIANT_ID_PREFIX}claude-opus-4.6-high`,
    name: "Claude Opus 4.6 (High)",
    baseModelId: "anthropic/claude-opus-4.6",
    providerOptions: {
      effort: "high",
    },
  },
];

/**
 * Combines built-in variants with user-defined variants.
 * Built-in variants appear first.
 */
export function getAllVariants(userVariants: ModelVariant[]): ModelVariant[] {
  return [...BUILT_IN_VARIANTS, ...userVariants];
}
