import { describe, expect, test } from "bun:test";
import { dedupeMessageReasoning } from "./dedupe-message-reasoning";
import type { WebAgentUIMessage } from "@/app/types";

/** Helper to build a minimal assistant message with the given parts. */
function msg(parts: WebAgentUIMessage["parts"]): WebAgentUIMessage {
  return {
    id: "msg_1",
    role: "assistant",
    parts,
    metadata: undefined as never,
  };
}

function reasoning(
  text: string,
  itemId?: string,
): WebAgentUIMessage["parts"][number] {
  return {
    type: "reasoning" as const,
    text,
    ...(itemId != null ? { providerMetadata: { openai: { itemId } } } : {}),
  };
}

describe("dedupeMessageReasoning", () => {
  test("returns same message when no reasoning parts exist", () => {
    const message = msg([{ type: "text" as const, text: "hello" }]);
    const result = dedupeMessageReasoning(message);
    expect(result).toBe(message); // same reference
  });

  test("returns same message when reasoning parts have no itemId", () => {
    const message = msg([
      reasoning("thinking..."),
      reasoning("more thinking..."),
    ]);
    const result = dedupeMessageReasoning(message);
    expect(result).toBe(message);
  });

  test("returns same message when reasoning parts have unique itemIds", () => {
    const message = msg([
      reasoning("thought 1", "rs_abc"),
      reasoning("thought 2", "rs_def"),
    ]);
    const result = dedupeMessageReasoning(message);
    expect(result).toBe(message);
  });

  test("preserves multi-summary parts (same itemId, different text)", () => {
    const message = msg([
      reasoning("summary part 0", "rs_abc"),
      reasoning("summary part 1", "rs_abc"),
      { type: "text" as const, text: "hello" },
    ]);
    const result = dedupeMessageReasoning(message);
    expect(result).toBe(message);
    expect(result.parts).toHaveLength(3);
  });

  test("removes exact duplicate reasoning (same itemId and text)", () => {
    const message = msg([
      { type: "step-start" as const },
      reasoning("thinking about it", "rs_abc"),
      { type: "text" as const, text: "answer" },
      reasoning("thinking about it", "rs_abc"), // duplicate
    ]);
    const result = dedupeMessageReasoning(message);
    expect(result).not.toBe(message); // new object
    expect(result.parts).toHaveLength(3);
    expect(result.parts).toEqual([
      { type: "step-start" },
      reasoning("thinking about it", "rs_abc"),
      { type: "text", text: "answer" },
    ]);
  });

  test("removes multiple duplicates", () => {
    const message = msg([
      reasoning("thought A", "rs_abc"),
      reasoning("thought B", "rs_def"),
      reasoning("thought A", "rs_abc"), // dup of first
      reasoning("thought B", "rs_def"), // dup of second
      { type: "text" as const, text: "answer" },
    ]);
    const result = dedupeMessageReasoning(message);
    expect(result.parts).toHaveLength(3);
    expect(result.parts[0]).toEqual(reasoning("thought A", "rs_abc"));
    expect(result.parts[1]).toEqual(reasoning("thought B", "rs_def"));
    expect(result.parts[2]).toEqual({ type: "text", text: "answer" });
  });

  test("keeps non-reasoning parts untouched", () => {
    const textPart = { type: "text" as const, text: "hello" };
    const stepStart = { type: "step-start" as const };
    const message = msg([
      stepStart,
      reasoning("thought", "rs_abc"),
      textPart,
      reasoning("thought", "rs_abc"), // dup
      textPart, // text parts are always kept (even if identical)
    ]);
    const result = dedupeMessageReasoning(message);
    expect(result.parts).toHaveLength(4);
    expect(result.parts).toEqual([
      stepStart,
      reasoning("thought", "rs_abc"),
      textPart,
      textPart,
    ]);
  });

  test("handles azure provider metadata", () => {
    const azureReasoning = (text: string, itemId: string) => ({
      type: "reasoning" as const,
      text,
      providerMetadata: { azure: { itemId } },
    });

    const message = msg([
      azureReasoning("thought", "rs_abc"),
      azureReasoning("thought", "rs_abc"), // dup
      { type: "text" as const, text: "done" },
    ]);
    const result = dedupeMessageReasoning(message);
    expect(result.parts).toHaveLength(2);
  });

  test("does not mutate the original message", () => {
    const original = msg([
      reasoning("thought", "rs_abc"),
      reasoning("thought", "rs_abc"),
    ]);
    const originalPartsLength = original.parts.length;
    dedupeMessageReasoning(original);
    expect(original.parts).toHaveLength(originalPartsLength);
  });
});
