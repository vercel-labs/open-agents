import { z } from "zod";

export const MODEL_VARIANT_ID_PREFIX = "variant:";
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

export function toProviderOptionsByProvider(
  baseModelId: string,
  providerOptions: Record<string, JsonValue>,
): ProviderOptionsByProvider | undefined {
  const provider = baseModelId.split("/")[0];
  if (!provider || Object.keys(providerOptions).length === 0) {
    return undefined;
  }

  return {
    [provider]: providerOptions,
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
