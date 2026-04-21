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
 * Format a USD cost for compact display alongside the model name.
 * Uses 4 decimals for sub-dollar amounts (typical for a single message)
 * and 2 decimals once we cross $1.
 */
function formatCostUsd(amount: number): string {
  if (amount === 0) {
    return "$0";
  }
  if (amount >= 1) {
    return (
      "$" +
      amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }
  // Show at least one significant digit for very small costs; cap at 4 decimals.
  if (amount < 0.0001) {
    return "<$0.0001";
  }
  return (
    "$" +
    amount.toLocaleString("en-US", {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    })
  );
}

/**
 * Compact pill shown on hover below an assistant message to indicate which
 * model produced the response.
 *
 * - Normal turn: shows the model display name.
 * - Variant turn: shows the variant label; tooltip reveals the resolved model.
 * - When the gateway reports a cost, the cumulative USD cost is rendered
 *   next to the model name.
 */
export function MessageModelPill({
  metadata,
  modelOptions,
}: MessageModelPillProps) {
  const {
    selectedModelId,
    modelId: resolvedModelId,
    totalMessageCost,
  } = metadata;

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
  const hasCost =
    typeof totalMessageCost === "number" &&
    Number.isFinite(totalMessageCost) &&
    totalMessageCost >= 0;

  // For variants, tooltip shows the underlying model that actually ran.
  // When cost is available we also surface it in the tooltip so the exact
  // value is visible even if the compact display rounds.
  const tooltipParts: string[] = [];
  if (isVariant && resolvedModelId && resolvedModelId !== selectedModelId) {
    tooltipParts.push(resolvedOption?.label ?? resolvedModelId);
  }
  if (hasCost) {
    tooltipParts.push(
      `Cost: ${(totalMessageCost as number).toFixed(6)} (gateway)`,
    );
  }

  const pill = (
    <span className="inline-flex max-w-[320px] items-center gap-1 rounded px-1.5 py-0.5 text-[11px] leading-tight text-muted-foreground/50 transition-colors hover:text-muted-foreground/80">
      <ProviderIcon provider={provider} className="size-3 shrink-0" />
      <span className="truncate">{shortLabel}</span>
      {hasCost && (
        <>
          <span aria-hidden className="text-muted-foreground/30">
            ·
          </span>
          <span className="tabular-nums">
            {formatCostUsd(totalMessageCost as number)}
          </span>
        </>
      )}
    </span>
  );

  if (tooltipParts.length === 0) {
    return pill;
  }

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent side="top" align="start">
        <span className="text-xs whitespace-pre-line">
          {tooltipParts.join("\n")}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
