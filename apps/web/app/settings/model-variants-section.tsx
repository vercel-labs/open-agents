"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import useSWR from "swr";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { ModelVariant } from "@/lib/model-variants";
import { type AvailableModel, getModelDisplayName } from "@/lib/models";
import { fetcher } from "@/lib/swr";

interface ModelsResponse {
  models: AvailableModel[];
}

interface ModelVariantsResponse {
  modelVariants: ModelVariant[];
}

function parseProviderOptions(
  input: string,
):
  | { providerOptions: Record<string, unknown>; error: null }
  | { providerOptions: null; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return {
      providerOptions: null,
      error: "Provider options must be valid JSON",
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      providerOptions: null,
      error: "Provider options must be a JSON object",
    };
  }

  return {
    providerOptions: parsed as Record<string, unknown>,
    error: null,
  };
}

export function ModelVariantsSectionSkeleton() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Model Variants</CardTitle>
          <CardDescription>
            Create named model presets with provider-specific options.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

export function ModelVariantsSection() {
  const {
    data: modelsData,
    isLoading: modelsLoading,
    error: modelsError,
  } = useSWR<ModelsResponse>("/api/models", fetcher);
  const {
    data: variantsData,
    isLoading: variantsLoading,
    error: variantsError,
    mutate,
  } = useSWR<ModelVariantsResponse>("/api/settings/model-variants", fetcher);

  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [baseModelId, setBaseModelId] = useState("");
  const [providerOptionsInput, setProviderOptionsInput] = useState("{}");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingVariantId, setDeletingVariantId] = useState<string | null>(
    null,
  );

  const models = modelsData?.models ?? [];
  const modelVariants = variantsData?.modelVariants ?? [];
  const firstModelId = modelsData?.models[0]?.id;

  useEffect(() => {
    if (baseModelId || !firstModelId) {
      return;
    }

    setBaseModelId(firstModelId);
  }, [baseModelId, firstModelId]);

  const modelNameById = new Map(
    models.map((model) => [model.id, getModelDisplayName(model)]),
  );

  const resetForm = () => {
    setEditingVariantId(null);
    setName("");
    setProviderOptionsInput("{}");
    setFormError(null);
  };

  const handleEdit = (variant: ModelVariant) => {
    setEditingVariantId(variant.id);
    setName(variant.name);
    setBaseModelId(variant.baseModelId);
    setProviderOptionsInput(JSON.stringify(variant.providerOptions, null, 2));
    setFormError(null);
  };

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError("Variant name is required");
      return;
    }

    if (!baseModelId) {
      setFormError("Base model is required");
      return;
    }

    const providerOptionsResult = parseProviderOptions(providerOptionsInput);
    if (providerOptionsResult.error) {
      setFormError(providerOptionsResult.error);
      return;
    }

    setFormError(null);
    setIsSubmitting(true);

    try {
      const method = editingVariantId ? "PATCH" : "POST";
      const payload = editingVariantId
        ? {
            id: editingVariantId,
            name: trimmedName,
            baseModelId,
            providerOptions: providerOptionsResult.providerOptions,
          }
        : {
            name: trimmedName,
            baseModelId,
            providerOptions: providerOptionsResult.providerOptions,
          };

      const response = await fetch("/api/settings/model-variants", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const responseData = (await response.json()) as {
        modelVariants?: ModelVariant[];
        error?: string;
      };

      if (!response.ok || !responseData.modelVariants) {
        throw new Error(responseData.error ?? "Failed to save model variant");
      }

      await mutate(
        { modelVariants: responseData.modelVariants },
        { revalidate: false },
      );
      resetForm();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Failed to save model variant",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (variantId: string) => {
    setDeletingVariantId(variantId);
    try {
      const response = await fetch("/api/settings/model-variants", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: variantId }),
      });

      const responseData = (await response.json()) as {
        modelVariants?: ModelVariant[];
        error?: string;
      };

      if (!response.ok || !responseData.modelVariants) {
        throw new Error(responseData.error ?? "Failed to delete model variant");
      }

      await mutate(
        { modelVariants: responseData.modelVariants },
        { revalidate: false },
      );
      if (editingVariantId === variantId) {
        resetForm();
      }
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Failed to delete model variant",
      );
    } finally {
      setDeletingVariantId(null);
    }
  };

  if (modelsLoading || variantsLoading) {
    return <ModelVariantsSectionSkeleton />;
  }

  if (modelsError || variantsError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Model Variants</CardTitle>
          <CardDescription>
            Unable to load model variants right now.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>
            {editingVariantId ? "Edit Variant" : "New Variant"}
          </CardTitle>
          <CardDescription>
            Create a named variant from any gateway model and provide JSON
            provider options.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="variant-name">Variant name</Label>
            <Input
              id="variant-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Codex 5.3 — Thinking XHigh"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="variant-base-model">Base model</Label>
            <Select value={baseModelId} onValueChange={setBaseModelId}>
              <SelectTrigger id="variant-base-model" className="w-full">
                <SelectValue placeholder="Select a base model" />
              </SelectTrigger>
              <SelectContent>
                {models.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {getModelDisplayName(model)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="variant-provider-options">
              Provider options JSON
            </Label>
            <Textarea
              id="variant-provider-options"
              value={providerOptionsInput}
              onChange={(event) => setProviderOptionsInput(event.target.value)}
              rows={10}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Example for OpenAI:{" "}
              {`{"reasoningEffort":"high","reasoningSummary":"detailed"}`}
            </p>
          </div>

          {formError ? (
            <p className="text-sm text-destructive">{formError}</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              <Plus className="h-4 w-4" />
              {editingVariantId ? "Save changes" : "Create variant"}
            </Button>
            {editingVariantId ? (
              <Button
                variant="outline"
                onClick={resetForm}
                disabled={isSubmitting || deletingVariantId !== null}
              >
                Cancel edit
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saved Variants</CardTitle>
          <CardDescription>
            Variants appear in model selectors across the web app.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {modelVariants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No model variants yet.
            </p>
          ) : (
            modelVariants.map((variant) => (
              <div
                key={variant.id}
                className="rounded-md border border-border p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{variant.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {variant.id} · Base:{" "}
                      {modelNameById.get(variant.baseModelId) ??
                        variant.baseModelId}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(variant)}
                      disabled={isSubmitting || deletingVariantId !== null}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(variant.id)}
                      disabled={
                        deletingVariantId !== null ||
                        isSubmitting ||
                        editingVariantId === variant.id
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
