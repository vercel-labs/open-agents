import { describe, expect, test } from "bun:test";
import { getInitialIsOnlyChatInSession } from "./only-chat-in-session";

describe("getInitialIsOnlyChatInSession", () => {
  test("returns true when the current chat is the session's only chat", () => {
    expect(getInitialIsOnlyChatInSession([{ id: "chat-1" }], "chat-1")).toBe(
      true,
    );
  });

  test("returns false when the session already has multiple chats", () => {
    expect(
      getInitialIsOnlyChatInSession(
        [{ id: "chat-1" }, { id: "chat-2" }],
        "chat-1",
      ),
    ).toBe(false);
  });

  test("returns false when chat summaries are stale and do not include the current chat", () => {
    expect(getInitialIsOnlyChatInSession([{ id: "chat-1" }], "chat-2")).toBe(
      false,
    );
  });
});
