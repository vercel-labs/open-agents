"use client";

import type { WebAgentMessageMetadata } from "@/app/types";
import type { ModelOption } from "@/lib/model-options";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface MessageModelPillProps {
  metadata: WebAgentMessageMetadata;
  modelOptions: ModelOption[];
}

/**
 * Compact pill rendered below an assistant message to show which model
 * produced the response.
 *
 * - Single-model turn: one pill with the model name.
 * - Variant turn: pill shows the variant label; tooltip shows the resolved
 *   underlying model.
 * - Multi-model turn (distinct models in stepModels > 1): pill shows the
 *   latest model plus "· N models" suffix.
 */
export function MessageModelPill({
  metadata,
  modelOptions,
}: MessageModelPillProps) {
  const { selectedModelId, modelId: resolvedModelId, stepModels } = metadata;

  // Nothing to show when no model info is present.
  if (!selectedModelId && !resolvedModelId) {
    return null;
  }

  const selectedOption = selectedModelId
    ? modelOptions.find((o) => o.id === selectedModelId)
    : undefined;
  const resolvedOption = resolvedModelId
    ? modelOptions.find((o) => o.id === resolvedModelId)
    : undefined;

  // Primary label: prefer the selected model's label (which could be a
  // variant name), fall back to the resolved model's label, then raw ids.
  const displayLabel =
    selectedOption?.label ??
    resolvedOption?.label ??
    selectedModelId ??
    resolvedModelId;

  if (!displayLabel) {
    return null;
  }

  const isVariant = selectedOption?.isVariant ?? false;

  // Count distinct resolved models across steps — not array length, since
  // every agent step appends an entry even when the model doesn't change.
  const distinctModelCount = stepModels
    ? new Set(stepModels.map((s) => s.modelId)).size
    : 0;
  const hasMultipleModels = distinctModelCount > 1;

  // Build tooltip for variants: show which model actually ran.
  let tooltipText: string | undefined;
  if (isVariant && resolvedModelId && resolvedModelId !== selectedModelId) {
    const resolvedName = resolvedOption?.label ?? resolvedModelId;
    tooltipText = resolvedName;
  }

  const pill = (
    <span className="inline-flex max-w-[240px] items-center gap-1 rounded px-1.5 py-0.5 text-[11px] leading-tight text-muted-foreground/50 transition-colors hover:text-muted-foreground/80">
      <span className="truncate">{displayLabel}</span>
      {hasMultipleModels && (
        <>
          <span className="text-muted-foreground/30">·</span>
          <span className="shrink-0">{distinctModelCount} models</span>
        </>
      )}
    </span>
  );

  if (!tooltipText) {
    return pill;
  }

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent side="top" align="start">
        <span className="text-xs">{tooltipText}</span>
      </TooltipContent>
    </Tooltip>
  );
}
