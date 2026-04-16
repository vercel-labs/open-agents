import type { WebAgentUIMessage } from "@/app/types";

export type { WebAgentUIMessage };

/**
 * Returns a reasoning item ID from a part's provider metadata, if present.
 *
 * OpenAI (and Azure OpenAI) Responses API reasoning parts carry an `itemId`
 * inside `providerMetadata.openai` (or `.azure`).  When a durable-workflow
 * step is replayed the streaming chunks are re-applied on top of the already-
 * persisted message, which can duplicate reasoning parts that share the same
 * item ID.
 */
export function getReasoningItemId(
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

/**
 * Check whether an assistant message contains only reasoning parts
 * (optionally with step-start markers) and no substantive content.
 */
function isReasoningOnlyMessage(message: WebAgentUIMessage): boolean {
  if (message.role !== "assistant") return false;

  return message.parts.every(
    (part) =>
      part.type === "reasoning" || part.type === "step-start",
  );
}

/**
 * Collect all reasoning item IDs from a message's parts.
 */
function collectReasoningItemIds(message: WebAgentUIMessage): string[] {
  const ids: string[] = [];
  for (const part of message.parts) {
    const itemId = getReasoningItemId(part);
    if (itemId != null) {
      ids.push(itemId);
    }
  }
  return ids;
}

/**
 * Remove cross-message duplicate reasoning from a list of messages.
 *
 * When a workflow stream is resumed/replayed, entire assistant messages can
 * be duplicated with blank reasoning parts that carry the same `rs_*` item IDs
 * as earlier messages. OpenAI requires item IDs to be unique across the input
 * history, so these duplicates poison subsequent turns.
 *
 * This function:
 * 1. Tracks all `rs_*` item IDs seen across messages in order.
 * 2. Removes blank reasoning-only assistant messages whose IDs were already
 *    seen in an earlier message.
 * 3. Strips duplicate reasoning parts (blank text, same ID) from messages that
 *    also contain substantive content.
 *
 * Returns a new array with poisoned messages removed. The original array is
 * not mutated.
 */
export function dedupeCrossMessageReasoning(
  messages: WebAgentUIMessage[],
): WebAgentUIMessage[] {
  const seenGlobalIds = new Set<string>();
  const result: WebAgentUIMessage[] = [];
  let changed = false;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    // Always track IDs from all messages (including non-assistant)
    const messageIds = collectReasoningItemIds(message);

    if (message.role !== "assistant") {
      for (const id of messageIds) {
        seenGlobalIds.add(id);
      }
      result.push(message);
      continue;
    }

    // Check if this assistant message's reasoning IDs are all duplicates
    const hasNewId = messageIds.some((id) => !seenGlobalIds.has(id));

    if (!hasNewId && isReasoningOnlyMessage(message)) {
      // Entire message is a replay — skip it
      changed = true;
      continue;
    }

    // Strip blank-text duplicate reasoning parts from this message
    let filteredParts = message.parts;
    for (const part of message.parts) {
      const itemId = getReasoningItemId(part);
      if (itemId == null) continue;
      if (!seenGlobalIds.has(itemId)) continue;
      // Drop blank-text reasoning part with a previously-seen ID
      if (part.type === "reasoning" && part.text.length === 0) {
        if (filteredParts === message.parts) {
          filteredParts = message.parts.filter((p) => {
            const pId = getReasoningItemId(p);
            if (pId == null) return true;
            if (!seenGlobalIds.has(pId)) return true;
            if (p.type === "reasoning" && p.text.length > 0) return true;
            return false;
          });
          changed = true;
        }
      }
    }

    for (const id of messageIds) {
      seenGlobalIds.add(id);
    }

    if (filteredParts.length === 0) {
      // All parts were stripped — skip this empty message
      changed = true;
      continue;
    }

    result.push(
      filteredParts === message.parts
        ? message
        : { ...message, parts: filteredParts },
    );
  }

  return changed ? result : messages;
}
