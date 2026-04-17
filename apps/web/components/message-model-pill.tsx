"use client";

import type { WebAgentMessageMetadata } from "@/app/types";
import type { ModelOption } from "@/lib/model-options";
import {
  ProviderIcon,
  getProviderFromModelId,
  stripProviderPrefix,
} from "@/components/provider-icons";
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
 * Compact pill shown on hover below an assistant message to indicate which
 * model produced the response.
 *
 * - Normal turn: shows the model display name.
 * - Variant turn: shows the variant label; tooltip reveals the resolved model.
 */
export function MessageModelPill({
  metadata,
  modelOptions,
}: MessageModelPillProps) {
  const { selectedModelId, modelId: resolvedModelId } = metadata;

  if (!selectedModelId && !resolvedModelId) {
    return null;
  }

  const selectedOption = selectedModelId
    ? modelOptions.find((o) => o.id === selectedModelId)
    : undefined;
  const resolvedOption = resolvedModelId
    ? modelOptions.find((o) => o.id === resolvedModelId)
    : undefined;

  const option = selectedOption ?? resolvedOption;
  const displayLabel =
    option?.shortLabel ?? option?.label ?? selectedModelId ?? resolvedModelId;

  if (!displayLabel) {
    return null;
  }

  const provider =
    option?.provider ??
    getProviderFromModelId(selectedModelId ?? resolvedModelId ?? "");

  const shortLabel = option
    ? (option.shortLabel ?? stripProviderPrefix(option.label, provider))
    : displayLabel;

  const isVariant = selectedOption?.isVariant ?? false;

  // For variants, tooltip shows the underlying model that actually ran.
  let tooltipText: string | undefined;
  if (isVariant && resolvedModelId && resolvedModelId !== selectedModelId) {
    tooltipText = resolvedOption?.label ?? resolvedModelId;
  }

  const pill = (
    <span className="inline-flex max-w-[240px] items-center gap-1 rounded px-1.5 py-0.5 text-[11px] leading-tight text-muted-foreground/50 transition-colors hover:text-muted-foreground/80">
      <ProviderIcon provider={provider} className="size-3 shrink-0" />
      <span className="truncate">{shortLabel}</span>
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
