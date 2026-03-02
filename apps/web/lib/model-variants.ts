import type { JSONValue } from "ai";
import { z } from "zod";

export const MODEL_VARIANT_ID_PREFIX = "variant:";

const providerOptionsSchema = z.record(z.string(), z.json());

export const modelVariantSchema = z.object({
  id: z.string().startsWith(MODEL_VARIANT_ID_PREFIX),
  name: z.string().trim().min(1).max(80),
  baseModelId: z.string().trim().min(1),
  providerOptions: providerOptionsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const modelVariantsSchema = z.array(modelVariantSchema);

export type ModelVariant = z.infer<typeof modelVariantSchema>;
export type ModelVariantProviderOptions = z.infer<typeof providerOptionsSchema>;

export type ProviderOptionsByProvider = Record<
  string,
  ModelVariantProviderOptions
>;

export const modelVariantCreateInputSchema = modelVariantSchema.pick({
  name: true,
  baseModelId: true,
  providerOptions: true,
});

export const modelVariantUpdateInputSchema = modelVariantSchema
  .pick({
    id: true,
    name: true,
    baseModelId: true,
    providerOptions: true,
  })
  .partial({
    name: true,
    baseModelId: true,
    providerOptions: true,
  });

export const modelVariantDeleteInputSchema = z.object({
  id: z.string().startsWith(MODEL_VARIANT_ID_PREFIX),
});

export function parseModelVariants(value: unknown): ModelVariant[] {
  const result = modelVariantsSchema.safeParse(value);
  if (!result.success) {
    return [];
  }
  return result.data;
}

export function isVariantModelId(
  modelId: string | null | undefined,
): modelId is string {
  return (
    typeof modelId === "string" && modelId.startsWith(MODEL_VARIANT_ID_PREFIX)
  );
}

function getProviderFromModelId(modelId: string): string | null {
  const slashIndex = modelId.indexOf("/");
  if (slashIndex <= 0) {
    return null;
  }

  const provider = modelId.slice(0, slashIndex);
  return provider.length > 0 ? provider : null;
}

function hasOwnEnumerableKeys(value: Record<string, JSONValue>): boolean {
  return Object.keys(value).length > 0;
}

export function toProviderOptionsByProvider(
  baseModelId: string,
  providerOptions: ModelVariantProviderOptions,
): ProviderOptionsByProvider | undefined {
  if (!hasOwnEnumerableKeys(providerOptions)) {
    return undefined;
  }

  const provider = getProviderFromModelId(baseModelId);
  if (!provider) {
    return undefined;
  }

  return {
    [provider]: providerOptions,
  };
}

export type ResolvedModelSelection = {
  selectedModelId: string;
  resolvedModelId: string;
  providerOptionsByProvider?: ProviderOptionsByProvider;
  variant: ModelVariant | null;
  missingVariant: boolean;
};

export function resolveModelSelection(
  selectedModelId: string,
  modelVariants: ModelVariant[],
): ResolvedModelSelection {
  if (!isVariantModelId(selectedModelId)) {
    return {
      selectedModelId,
      resolvedModelId: selectedModelId,
      variant: null,
      missingVariant: false,
    };
  }

  const variant = modelVariants.find((entry) => entry.id === selectedModelId);
  if (!variant) {
    return {
      selectedModelId,
      resolvedModelId: selectedModelId,
      variant: null,
      missingVariant: true,
    };
  }

  return {
    selectedModelId,
    resolvedModelId: variant.baseModelId,
    providerOptionsByProvider: toProviderOptionsByProvider(
      variant.baseModelId,
      variant.providerOptions,
    ),
    variant,
    missingVariant: false,
  };
}
