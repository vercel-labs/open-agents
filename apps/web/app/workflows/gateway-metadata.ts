import type { ProviderMetadata } from "ai";

/**
 * Shape of the Vercel AI Gateway entry in `providerMetadata`.
 *
 * The gateway surfaces per-step cost information alongside routing
 * diagnostics. We only care about the cost field here; everything else is
 * documented for reference.
 */
export interface GatewayProviderMetadata {
  gateway: {
    cost?: string;
    marketCost?: string;
    inferenceCost?: string;
    inputInferenceCost?: string;
    outputInferenceCost?: string;
    generationId?: string;
  };
}

function hasGatewayShape(
  metadata: ProviderMetadata | undefined,
): metadata is ProviderMetadata & GatewayProviderMetadata {
  if (!metadata) {
    return false;
  }
  const gateway = (metadata as Record<string, unknown>).gateway;
  return typeof gateway === "object" && gateway !== null;
}

/**
 * Extract the gateway-reported cost for a single step.
 * Returns `undefined` when the step did not go through the gateway or the
 * gateway did not attach a cost (e.g. direct provider call).
 */
export function extractGatewayCost(
  providerMetadata: ProviderMetadata | undefined,
): number | undefined {
  if (!hasGatewayShape(providerMetadata)) {
    return undefined;
  }
  const rawCost = providerMetadata.gateway.cost;
  if (typeof rawCost !== "string") {
    return undefined;
  }
  const cost = Number.parseFloat(rawCost);
  return Number.isFinite(cost) ? cost : undefined;
}
