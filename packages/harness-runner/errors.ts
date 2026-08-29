/**
 * Machine-readable classification of known harness failure modes, populated
 * where the raw failure text originates so consumers (the chat workflow) can
 * map codes to user-facing copy without sniffing error strings.
 */
export type HarnessTurnErrorCode =
  | "missing-ws-module"
  | "gateway-auth-failed"
  | "bridge-not-ready";

export function classifyHarnessErrorCode(
  rawFinishReason: string | undefined,
): HarnessTurnErrorCode | undefined {
  if (!rawFinishReason) {
    return undefined;
  }

  // The sandbox is missing the prepared harness runtime (bridge dependency).
  if (rawFinishReason.includes("Cannot find package 'ws'")) {
    return "missing-ws-module";
  }

  // AI Gateway rejected the configured credentials.
  if (
    rawFinishReason.includes("Authentication failed") &&
    rawFinishReason.includes("AI_GATEWAY_API_KEY")
  ) {
    return "gateway-auth-failed";
  }

  // The sandbox bridge process never reached its ready state.
  if (
    rawFinishReason.includes("Bridge process exited without becoming ready")
  ) {
    return "bridge-not-ready";
  }

  return undefined;
}
