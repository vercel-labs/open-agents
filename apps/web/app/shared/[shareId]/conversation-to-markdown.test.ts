import { describe, expect, test } from "bun:test";
import type { WebAgentUIMessage } from "@/app/types";
import { conversationToMarkdown } from "./conversation-to-markdown";
import type { MessageWithTiming } from "./shared-chat-content";

function makeMessage(
  role: WebAgentUIMessage["role"],
  parts: ReadonlyArray<unknown>,
): MessageWithTiming {
  return {
    message: {
      id: `msg-${Math.random().toString(36).slice(2, 8)}`,
      role,
      parts,
    } as unknown as WebAgentUIMessage,
    durationMs: null,
  };
}

const SHARED_AT = new Date("2026-04-13T15:00:00.000Z");

describe("conversationToMarkdown", () => {
  test("emits header with title and share id", () => {
    const md = conversationToMarkdown({
      title: "Fixing the flaky test",
      shareId: "abc123",
      sharedAt: SHARED_AT,
      chats: [],
    });
    expect(md).toContain("# Fixing the flaky test");
    expect(md).toContain("Share ID: abc123");
    expect(md).toContain("Shared from Open Agents - 2026-04-13T15:00:00.000Z");
  });

  test("falls back to default title when missing", () => {
    const md = conversationToMarkdown({
      title: null,
      shareId: "xyz",
      sharedAt: SHARED_AT,
      chats: [],
    });
    expect(md.startsWith("# Shared Chat")).toBe(true);
  });

  test("renders user and agent text messages with headings", () => {
    const md = conversationToMarkdown({
      title: "Example",
      shareId: "abc",
      sharedAt: SHARED_AT,
      chats: [
        {
          title: null,
          messages: [
            makeMessage("user", [{ type: "text", text: "Please add a retry" }]),
            makeMessage("assistant", [
              { type: "text", text: "Done. Wired retry into handleTimeout." },
            ]),
          ],
        },
      ],
    });
    expect(md).toContain("## User");
    expect(md).toContain("Please add a retry");
    expect(md).toContain("## Agent");
    expect(md).toContain("Done. Wired retry into handleTimeout.");
  });

  test("renders dynamic-tool parts with the actual toolName", () => {
    const md = conversationToMarkdown({
      title: "Example",
      shareId: "abc",
      sharedAt: SHARED_AT,
      chats: [
        {
          title: null,
          messages: [
            makeMessage("assistant", [
              {
                type: "dynamic-tool",
                toolName: "mcp__context7__resolve-library-id",
                toolCallId: "call-dyn-1",
                state: "output-available",
                input: { libraryName: "react" },
                output: { id: "/facebook/react" },
              },
            ]),
          ],
        },
      ],
    });
    expect(md).toContain(
      "### Tool call: mcp__context7__resolve-library-id (output-available)",
    );
    expect(md).not.toContain("### Tool call: dynamic-tool");
    expect(md).toContain('"libraryName": "react"');
  });

  test("renders tool calls in fenced blocks with name", () => {
    const md = conversationToMarkdown({
      title: "Example",
      shareId: "abc",
      sharedAt: SHARED_AT,
      chats: [
        {
          title: null,
          messages: [
            makeMessage("assistant", [
              {
                type: "tool-read",
                toolCallId: "call-1",
                state: "output-available",
                input: { path: "README.md" },
                output: { text: "hello" },
              },
            ]),
          ],
        },
      ],
    });
    expect(md).toContain("### Tool call: read");
    expect(md).toContain("```json");
    expect(md).toContain('"path": "README.md"');
  });

  test("replaces non-text data parts with placeholder", () => {
    const md = conversationToMarkdown({
      title: null,
      shareId: "abc",
      sharedAt: SHARED_AT,
      chats: [
        {
          title: null,
          messages: [
            makeMessage("assistant", [
              { type: "data-commit", data: { sha: "abc123" } },
            ]),
          ],
        },
      ],
    });
    expect(md).toContain("[attachment: commit]");
  });

  test("skips messages with no renderable parts", () => {
    const md = conversationToMarkdown({
      title: "Empty",
      shareId: "abc",
      sharedAt: SHARED_AT,
      chats: [
        {
          title: null,
          messages: [makeMessage("assistant", [{ type: "text", text: "   " }])],
        },
      ],
    });
    expect(md).not.toContain("## Agent");
  });

  test("prepends chat title when multiple chats exist", () => {
    const md = conversationToMarkdown({
      title: "Example",
      shareId: "abc",
      sharedAt: SHARED_AT,
      chats: [
        {
          title: "Initial planning",
          messages: [
            makeMessage("user", [{ type: "text", text: "First message" }]),
          ],
        },
        {
          title: "Follow-up work",
          messages: [
            makeMessage("user", [{ type: "text", text: "Follow up" }]),
          ],
        },
      ],
    });
    expect(md).toContain("# Initial planning");
    expect(md).toContain("# Follow-up work");
    expect(md).toContain("First message");
    expect(md).toContain("Follow up");
  });

  test("does not prepend chat title when only one chat", () => {
    const md = conversationToMarkdown({
      title: "Example",
      shareId: "abc",
      sharedAt: SHARED_AT,
      chats: [
        {
          title: "Single",
          messages: [
            makeMessage("user", [{ type: "text", text: "Only message" }]),
          ],
        },
      ],
    });
    expect(md).not.toContain("# Single");
    expect(md).toContain("Only message");
  });
});
