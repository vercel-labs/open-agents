import type { WebAgentUIMessage } from "@/app/types";

/**
 * Returns a reasoning item ID from a part's provider metadata, if present.
 *
 * OpenAI (and Azure OpenAI) Responses API reasoning parts carry an `itemId`
 * inside `providerMetadata.openai` (or `.azure`).  When a durable-workflow
 * step is replayed the streaming chunks are re-applied on top of the already-
 * persisted message, which can duplicate reasoning parts that share the same
 * item ID.
 */
function getReasoningItemId(
  part: WebAgentUIMessage["parts"][number],
): string | undefined {
  if (part.type !== "reasoning") return undefined;

  const meta = part.providerMetadata as
    | Record<string, Record<string, unknown> | undefined>
    | undefined;

  const openai = meta?.openai ?? meta?.azure;
  const itemId = openai?.itemId;
  return typeof itemId === "string" ? itemId : undefined;
}

/**
 * Remove duplicate reasoning parts from a message's `parts` array.
 *
 * A reasoning part is considered a duplicate when another part with the same
 * provider-level item ID **and** the same text already exists earlier in the
 * array.  Multi-summary parts (same item ID, different text) are intentionally
 * kept because they represent distinct summary segments of a single reasoning
 * output.
 *
 * Returns a **new** message object when duplicates are found; the original is
 * returned as-is when the parts are already clean.
 */
export function dedupeMessageReasoning<T extends WebAgentUIMessage>(
  message: T,
): T {
  const seen = new Set<string>();
  let hasDuplicates = false;

  for (const part of message.parts) {
    const itemId = getReasoningItemId(part);
    if (itemId == null) continue;

    // Composite key: item ID + text content.  Two parts for the same
    // reasoning output but with different summary text are *not* duplicates.
    const key = `${itemId}\0${part.type === "reasoning" ? part.text : ""}`;

    if (seen.has(key)) {
      hasDuplicates = true;
      break;
    }
    seen.add(key);
  }

  if (!hasDuplicates) return message;

  // Second pass: rebuild parts without duplicates.
  const deduped = new Set<string>();
  const filteredParts = message.parts.filter((part) => {
    const itemId = getReasoningItemId(part);
    if (itemId == null) return true;

    const key = `${itemId}\0${part.type === "reasoning" ? part.text : ""}`;
    if (deduped.has(key)) return false;
    deduped.add(key);
    return true;
  });

  return { ...message, parts: filteredParts };
}
