/**
 * External harness identifiers.
 *
 * This module is dependency-free on purpose: the web client bundle imports
 * these ids without dragging the `@ai-sdk/harness-*` adapters (and their
 * Node.js dependencies) along. Import it via
 * `@open-agents/harness-runner/ids`.
 *
 * `HARNESS_DEFINITIONS` in `adapters.ts` is keyed by `ExternalHarnessId`, so
 * the registry cannot drift from this list without a type error (plus a
 * runtime assertion in `adapters.test.ts`).
 */
export const EXTERNAL_HARNESS_IDS = ["codex", "claude-code", "pi"] as const;

export type ExternalHarnessId = (typeof EXTERNAL_HARNESS_IDS)[number];

export function isExternalHarnessId(
  value: unknown,
): value is ExternalHarnessId {
  return (
    typeof value === "string" &&
    EXTERNAL_HARNESS_IDS.includes(value as ExternalHarnessId)
  );
}
