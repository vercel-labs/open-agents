"use client";

import useSWR from "swr";
import type { ModelVariant } from "@/lib/model-variants";
import { type AvailableModel, getModelDisplayName } from "@/lib/models";
import { fetcher } from "@/lib/swr";

interface ModelsResponse {
  models: AvailableModel[];
}

interface ModelVariantsResponse {
  modelVariants: ModelVariant[];
}

export interface ModelOption {
  id: string;
  label: string;
  description: string;
  isVariant: boolean;
}

export function useModelOptions() {
  const {
    data: modelsData,
    isLoading: modelsLoading,
    error: modelsError,
  } = useSWR<ModelsResponse>("/api/models", fetcher);
  const {
    data: variantsData,
    isLoading: variantsLoading,
    error: variantsError,
  } = useSWR<ModelVariantsResponse>("/api/settings/model-variants", fetcher);

  const models = modelsData?.models ?? [];
  const modelVariants = variantsData?.modelVariants ?? [];

  const modelNameById = new Map(
    models.map((model) => [model.id, getModelDisplayName(model)]),
  );

  const baseModelOptions: ModelOption[] = models.map((model) => ({
    id: model.id,
    label: getModelDisplayName(model),
    description: model.id,
    isVariant: false,
  }));

  const variantOptions: ModelOption[] = modelVariants.map((variant) => {
    const baseModelName = modelNameById.get(variant.baseModelId);
    return {
      id: variant.id,
      label: variant.name,
      description: baseModelName
        ? `Variant of ${baseModelName}`
        : `Variant of ${variant.baseModelId}`,
      isVariant: true,
    };
  });

  return {
    modelOptions: [...baseModelOptions, ...variantOptions],
    models,
    modelVariants,
    loading: modelsLoading || variantsLoading,
    modelsLoading,
    variantsLoading,
    modelsError: modelsError ?? null,
    variantsError: variantsError ?? null,
  };
}
