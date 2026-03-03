"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { ModelCombobox } from "@/components/model-combobox";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { type AvailableModel, getModelDisplayName } from "@/lib/models";
import {
  providerOptionsSchema,
  type JsonValue,
  type ModelVariant,
} from "@/lib/model-variants";
import { fetcher } from "@/lib/swr";

interface ModelsResponse {
  models: AvailableModel[];
}

interface ModelVariantsResponse {
  modelVariants: ModelVariant[];
}

const EMPTY_MODELS: AvailableModel[] = [];
const EMPTY_MODEL_VARIANTS: ModelVariant[] = [];

function parseProviderOptions(
  input: string,
):
  | { success: true; data: Record<string, JsonValue> }
  | { success: false; error: string } {
  let parsed: unknown;

  try {
    parsed = JSON.parse(input || "{}");
  } catch {
    return { success: false, error: "Provider options must be valid JSON" };
  }

  const validated = providerOptionsSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      success: false,
      error: "Provider options must be a JSON object",
    };
  }

  return { success: true, data: validated.data };
}

export function ModelVariantsSectionSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Model Variants</CardTitle>
        <CardDescription>
          Create named presets with provider-specific options for a base model.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-28 w-full" />
      </CardContent>
    </Card>
  );
}

export function ModelVariantsSection() {
  const { data: modelsData, isLoading: modelsLoading } = useSWR<ModelsResponse>(
    "/api/models",
    fetcher,
  );
  const {
    data: variantsData,
    isLoading: variantsLoading,
    mutate,
  } = useSWR<ModelVariantsResponse>("/api/settings/model-variants", fetcher);

  const models = modelsData?.models ?? EMPTY_MODELS;
  const modelVariants = variantsData?.modelVariants ?? EMPTY_MODEL_VARIANTS;

  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [baseModelId, setBaseModelId] = useState("");
  const [providerOptionsText, setProviderOptionsText] = useState("{}");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!baseModelId && models[0]?.id) {
      setBaseModelId(models[0].id);
    }
  }, [baseModelId, models]);

  const modelItems = useMemo(
    () =>
      models.map((model) => ({
        id: model.id,
        label: getModelDisplayName(model),
      })),
    [models],
  );

  const modelNameById = useMemo(
    () =>
      new Map(models.map((model) => [model.id, getModelDisplayName(model)])),
    [models],
  );

  const resetForm = () => {
    setEditingVariantId(null);
    setName("");
    setProviderOptionsText("{}");
    setError(null);
    if (models[0]?.id) {
      setBaseModelId(models[0].id);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    if (!baseModelId) {
      setError("Base model is required");
      return;
    }

    const parsedProviderOptions = parseProviderOptions(providerOptionsText);
    if (!parsedProviderOptions.success) {
      setError(parsedProviderOptions.error);
      return;
    }

    setError(null);
    setIsSaving(true);

    try {
      const method = editingVariantId ? "PATCH" : "POST";
      const body = editingVariantId
        ? {
            id: editingVariantId,
            name: name.trim(),
            baseModelId,
            providerOptions: parsedProviderOptions.data,
          }
        : {
            name: name.trim(),
            baseModelId,
            providerOptions: parsedProviderOptions.data,
          };

      const response = await fetch("/api/settings/model-variants", {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const responseData = (await response.json()) as
        | ModelVariantsResponse
        | { error?: string };

      if (!response.ok) {
        const message =
          "error" in responseData
            ? responseData.error
            : "Failed to save model variant";
        setError(message ?? "Failed to save model variant");
        return;
      }

      if (!("modelVariants" in responseData)) {
        setError("Failed to save model variant");
        return;
      }

      const nextVariants = responseData.modelVariants;
      await mutate({ modelVariants: nextVariants }, { revalidate: false });
      resetForm();
    } catch (submitError) {
      console.error("Failed to save model variant:", submitError);
      setError("Failed to save model variant");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (variant: ModelVariant) => {
    setEditingVariantId(variant.id);
    setName(variant.name);
    setBaseModelId(variant.baseModelId);
    setProviderOptionsText(JSON.stringify(variant.providerOptions, null, 2));
    setError(null);
  };

  const handleDelete = async (variantId: string) => {
    if (!window.confirm("Delete this model variant?")) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/settings/model-variants", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: variantId }),
      });

      const responseData = (await response.json()) as
        | ModelVariantsResponse
        | { error?: string };

      if (!response.ok) {
        const message =
          "error" in responseData
            ? responseData.error
            : "Failed to delete model variant";
        setError(message ?? "Failed to delete model variant");
        return;
      }

      if (!("modelVariants" in responseData)) {
        setError("Failed to delete model variant");
        return;
      }

      const nextVariants = responseData.modelVariants;
      await mutate({ modelVariants: nextVariants }, { revalidate: false });

      if (editingVariantId === variantId) {
        resetForm();
      }
    } catch (deleteError) {
      console.error("Failed to delete model variant:", deleteError);
      setError("Failed to delete model variant");
    } finally {
      setIsSaving(false);
    }
  };

  if (modelsLoading || variantsLoading) {
    return <ModelVariantsSectionSkeleton />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Model Variants</CardTitle>
          <CardDescription>
            Create named presets that wrap a base model with provider-specific
            options JSON.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="variant-name">Name</Label>
              <Input
                id="variant-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Claude Adaptive Thinking"
                disabled={isSaving}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="base-model">Base Model</Label>
              <ModelCombobox
                value={baseModelId}
                items={modelItems}
                placeholder="Select a base model"
                searchPlaceholder="Search base models..."
                emptyText="No base models found."
                disabled={isSaving}
                onChange={setBaseModelId}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="provider-options">Provider Options (JSON)</Label>
              <Textarea
                id="provider-options"
                value={providerOptionsText}
                onChange={(event) => setProviderOptionsText(event.target.value)}
                className="min-h-36 font-mono text-xs"
                disabled={isSaving}
              />
              <p className="text-xs text-muted-foreground">
                Example:{" "}
                {'{"reasoningEffort":"medium","reasoningSummary":"auto"}'}
              </p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={isSaving}>
                {editingVariantId ? (
                  <>
                    <Pencil className="mr-2 h-4 w-4" />
                    Save Variant
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Variant
                  </>
                )}
              </Button>

              {editingVariantId && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetForm}
                  disabled={isSaving}
                >
                  <X className="mr-2 h-4 w-4" />
                  Cancel Edit
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saved Variants</CardTitle>
          <CardDescription>
            Variants appear alongside regular models in selectors across the
            app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {modelVariants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No model variants yet. Create one above.
            </p>
          ) : (
            <div className="space-y-4">
              {modelVariants.map((variant) => (
                <div
                  key={variant.id}
                  className="rounded-md border border-border p-3 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-medium">{variant.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        Base model:{" "}
                        {modelNameById.get(variant.baseModelId) ??
                          variant.baseModelId}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {variant.id}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => handleEdit(variant)}
                        disabled={isSaving}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDelete(variant.id)}
                        disabled={isSaving}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <pre className="max-h-48 overflow-auto rounded bg-muted/50 p-2 text-xs">
                    {JSON.stringify(variant.providerOptions, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
