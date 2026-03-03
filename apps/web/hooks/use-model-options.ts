"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { buildModelOptions, type ModelOption } from "@/lib/model-options";
import type { AvailableModel } from "@/lib/models";
import type { ModelVariant } from "@/lib/model-variants";
import { fetcher } from "@/lib/swr";

interface ModelsResponse {
  models: AvailableModel[];
}

interface ModelVariantsResponse {
  modelVariants: ModelVariant[];
}

const EMPTY_MODELS: AvailableModel[] = [];
const EMPTY_MODEL_VARIANTS: ModelVariant[] = [];

export function useModelOptions() {
  const {
    data: modelsData,
    error: modelsError,
    isLoading: modelsLoading,
  } = useSWR<ModelsResponse>("/api/models", fetcher);

  const {
    data: variantsData,
    error: variantsError,
    isLoading: variantsLoading,
  } = useSWR<ModelVariantsResponse>("/api/settings/model-variants", fetcher);

  const models = modelsData?.models ?? EMPTY_MODELS;
  const modelVariants = variantsData?.modelVariants ?? EMPTY_MODEL_VARIANTS;

  const modelOptions = useMemo<ModelOption[]>(
    () => buildModelOptions(models, modelVariants),
    [models, modelVariants],
  );

  return {
    modelOptions,
    models,
    modelVariants,
    loading: modelsLoading || variantsLoading,
    error: modelsError?.message ?? variantsError?.message ?? null,
  };
}
