import type { UIMessage, UIMessageChunk } from "ai";

/**
 * Public API of the harness runner. Internal building blocks (adapters
 * registry, prompt building, chunk transforms, usage arithmetic) live in
 * their own modules and are not part of this surface.
 */

export {
  EXTERNAL_HARNESS_IDS,
  isExternalHarnessId,
  type ExternalHarnessId,
} from "./ids.ts";
export { ensureGatewayApiKeyEnv } from "./auth.ts";
export type { HarnessTurnErrorCode } from "./errors.ts";
export { prepareHarnessSandboxRuntimeProfile } from "./prewarm.ts";
export {
  runHarnessTurn,
  type HarnessTurnResult,
  type RunHarnessTurnInput,
} from "./run-turn.ts";
export type { HarnessUsage } from "./usage.ts";

/**
 * The runner speaks plain AI SDK UI messages and chunks on the wire. These
 * aliases exist so consumers can name the runner's wire types without
 * importing `ai` themselves; no conversion is involved.
 */
export type HarnessUIMessage = UIMessage;
export type HarnessUIMessageChunk = UIMessageChunk;
