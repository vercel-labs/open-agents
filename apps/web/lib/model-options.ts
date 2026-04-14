import {
  APP_DEFAULT_MODEL_ID,
  type AvailableModel,
  type AvailableModelCost,
  getModelDisplayName,
} from "@/lib/models";
import {
  MODEL_VARIANT_ID_PREFIX,
  type ModelVariant,
} from "@/lib/model-variants";

export interface ModelOption {
  id: string;
  label: string;
  description?: string;
  isVariant: boolean;
  contextWindow?: number;
  cost?: AvailableModelCost;
}

function toBaseModelOption(model: AvailableModel): ModelOption {
  return {
    id: model.id,
    label: getModelDisplayName(model),
    description: model.description ?? undefined,
    isVariant: false,
    contextWindow: model.context_window,
    ...(model.cost ? { cost: model.cost } : {}),
  };
}

function toVariantOption(
  variant: ModelVariant,
  baseModel?: AvailableModel,
): ModelOption {
  const baseLabel = baseModel
    ? getModelDisplayName(baseModel)
    : variant.baseModelId;

  return {
    id: variant.id,
    label: variant.name,
    description: `Variant of ${baseLabel}`,
    isVariant: true,
    contextWindow: baseModel?.context_window,
    ...(baseModel?.cost ? { cost: baseModel.cost } : {}),
  };
}

export function buildModelOptions(
  models: AvailableModel[],
  modelVariants: ModelVariant[],
): ModelOption[] {
  const baseModelOptions = models.map(toBaseModelOption);
  const baseModelsById = new Map(models.map((model) => [model.id, model]));

  const variantOptions = modelVariants.map((variant) =>
    toVariantOption(variant, baseModelsById.get(variant.baseModelId)),
  );

  return [...baseModelOptions, ...variantOptions];
}

export function buildSessionChatModelOptions(
  models: AvailableModel[],
  modelVariants: ModelVariant[],
): ModelOption[] {
  return buildModelOptions(models, modelVariants);
}

export function withMissingModelOption(
  modelOptions: ModelOption[],
  modelId: string | null | undefined,
): ModelOption[] {
  if (!modelId || modelOptions.some((option) => option.id === modelId)) {
    return modelOptions;
  }

  if (!modelId.startsWith(MODEL_VARIANT_ID_PREFIX)) {
    return modelOptions;
  }

  const label = `${modelId.slice(MODEL_VARIANT_ID_PREFIX.length)} (missing)`;

  return [
    ...modelOptions,
    {
      id: modelId,
      label,
      description: "Variant no longer exists",
      isVariant: true,
      contextWindow: undefined,
    },
  ];
}

export function getDefaultModelOptionId(modelOptions: ModelOption[]): string {
  if (modelOptions.some((option) => option.id === APP_DEFAULT_MODEL_ID)) {
    return APP_DEFAULT_MODEL_ID;
  }

  return modelOptions[0]?.id ?? APP_DEFAULT_MODEL_ID;
}
