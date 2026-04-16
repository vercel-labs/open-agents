import { describe, expect, test } from "bun:test";
import { dedupeMessageReasoning, dedupeCrossMessageReasoning } from "./dedupe-message-reasoning";
import type { WebAgentUIMessage } from "@/app/types";

/** Helper to build a minimal assistant message with the given parts. */
function msg(
  parts: WebAgentUIMessage["parts"],
  id = "msg_1",
): WebAgentUIMessage {
  return {
    id,
    role: "assistant",
    parts,
    metadata: undefined as never,
  };
}

function userMsg(
  text: string,
  id = "user_1",
): WebAgentUIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text" as const, text }],
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

describe("dedupeCrossMessageReasoning", () => {
  test("returns same array when no assistant messages have reasoning", () => {
    const messages = [
      userMsg("hello"),
      msg([{ type: "text" as const, text: "hi" }]),
    ];
    const result = dedupeCrossMessageReasoning(messages);
    expect(result).toBe(messages); // same reference
  });

  test("removes replayed blank reasoning-only assistant message", () => {
    // Simulate: original message with reasoning + text, then a replay with only blank reasoning
    const messages = [
      userMsg("question"),
      msg(
        [
          reasoning("thinking about it", "rs_abc"),
          { type: "text" as const, text: "answer" },
        ],
        "msg_1",
      ),
      // Replay: blank reasoning-only message with same ID
      msg(
        [
          { type: "step-start" as const },
          reasoning("", "rs_abc"), // blank text, same ID as msg_1
        ],
        "msg_2",
      ),
    ];

    const result = dedupeCrossMessageReasoning(messages);
    expect(result).toHaveLength(2); // user + original assistant
    expect(result[1].id).toBe("msg_1");
  });

  test("keeps assistant message with new reasoning IDs", () => {
    const messages = [
      userMsg("question"),
      msg(
        [
          reasoning("first thought", "rs_abc"),
          { type: "text" as const, text: "answer" },
        ],
        "msg_1",
      ),
      msg(
        [
          reasoning("second thought", "rs_def"), // new ID
          { type: "text" as const, text: "more" },
        ],
        "msg_2",
      ),
    ];

    const result = dedupeCrossMessageReasoning(messages);
    expect(result).toHaveLength(3);
  });

  test("strips blank duplicate reasoning parts from mixed message", () => {
    const messages = [
      userMsg("question"),
      msg(
        [
          reasoning("real thought", "rs_abc"),
          { type: "text" as const, text: "answer" },
        ],
        "msg_1",
      ),
      // Message with both new and old reasoning IDs
      msg(
        [
          reasoning("", "rs_abc"), // blank duplicate
          reasoning("new thought", "rs_def"), // new
          { type: "text" as const, text: "more" },
        ],
        "msg_2",
      ),
    ];

    const result = dedupeCrossMessageReasoning(messages);
    expect(result).toHaveLength(3);
    // msg_2 should have the blank rs_abc stripped but keep rs_def and text
    const lastMsg = result[2];
    expect(lastMsg.parts).toHaveLength(2);
    expect(lastMsg.parts[0]).toEqual(reasoning("new thought", "rs_def"));
    expect(lastMsg.parts[1]).toEqual({ type: "text", text: "more" });
  });

  test("preserves non-blank multi-summary reasoning across messages", () => {
    const messages = [
      userMsg("question"),
      msg(
        [
          reasoning("summary part 0", "rs_abc"),
          { type: "text" as const, text: "answer" },
        ],
        "msg_1",
      ),
      // Different text content for same ID = multi-summary, keep it
      msg(
        [
          reasoning("summary part 1", "rs_abc"),
          { type: "text" as const, text: "more" },
        ],
        "msg_2",
      ),
    ];

    const result = dedupeCrossMessageReasoning(messages);
    expect(result).toHaveLength(3);
    expect(result[2].parts).toHaveLength(2); // non-blank reasoning + text kept
  });

  test("removes message that becomes empty after stripping duplicates", () => {
    const messages = [
      userMsg("question"),
      msg(
        [
          reasoning("thought", "rs_abc"),
          { type: "text" as const, text: "answer" },
        ],
        "msg_1",
      ),
      // This message only has a blank duplicate reasoning part
      msg([reasoning("", "rs_abc")], "msg_2"),
    ];

    const result = dedupeCrossMessageReasoning(messages);
    expect(result).toHaveLength(2);
  });

  test("handles azure provider metadata in cross-message dedup", () => {
    const azureReasoning = (text: string, itemId: string) => ({
      type: "reasoning" as const,
      text,
      providerMetadata: { azure: { itemId } },
    });

    const messages = [
      userMsg("question"),
      msg(
        [
          azureReasoning("thought", "rs_abc"),
          { type: "text" as const, text: "answer" },
        ],
        "msg_1",
      ),
      msg([azureReasoning("", "rs_abc")], "msg_2"), // blank duplicate
    ];

    const result = dedupeCrossMessageReasoning(messages);
    expect(result).toHaveLength(2); // replay removed
  });

  test("does not mutate original messages array or message objects", () => {
    const messages = [
      userMsg("question"),
      msg(
        [
          reasoning("thought", "rs_abc"),
          { type: "text" as const, text: "answer" },
        ],
        "msg_1",
      ),
      msg([reasoning("", "rs_abc")], "msg_2"),
    ];

    const originalLength = messages.length;
    const originalPartsLength = messages[1].parts.length;
    dedupeCrossMessageReasoning(messages);
    expect(messages).toHaveLength(originalLength);
    expect(messages[1].parts).toHaveLength(originalPartsLength);
  });
});
