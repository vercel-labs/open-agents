import { describe, expect, mock, test } from "bun:test";
import {
  clearChatWorkspaceStatus,
  getChatWorkspaceStatusSnapshot,
  setChatWorkspaceStatus,
  subscribeChatWorkspaceStatus,
} from "@/lib/workspace-status-store";

describe("workspace status store", () => {
  test("stores the latest workspace status per chat", () => {
    clearChatWorkspaceStatus("chat-store-a");
    clearChatWorkspaceStatus("chat-store-b");

    setChatWorkspaceStatus("chat-store-a", {
      status: "setting-up",
      message: "Setting up workspace A...",
    });
    setChatWorkspaceStatus("chat-store-b", {
      status: "setting-up",
      message: "Setting up workspace B...",
    });

    expect(getChatWorkspaceStatusSnapshot("chat-store-a")?.message).toBe(
      "Setting up workspace A...",
    );
    expect(getChatWorkspaceStatusSnapshot("chat-store-b")?.message).toBe(
      "Setting up workspace B...",
    );

    clearChatWorkspaceStatus("chat-store-a");
    clearChatWorkspaceStatus("chat-store-b");
  });

  test("notifies subscribers when status changes", () => {
    clearChatWorkspaceStatus("chat-store-subscribe");

    const listener = mock(() => {});
    const unsubscribe = subscribeChatWorkspaceStatus(
      "chat-store-subscribe",
      listener,
    );

    setChatWorkspaceStatus("chat-store-subscribe", {
      status: "setting-up",
      message: "Setting up workspace...",
    });

    expect(listener).toHaveBeenCalledTimes(1);

    clearChatWorkspaceStatus("chat-store-subscribe");

    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  test("does not notify after unsubscribe", () => {
    clearChatWorkspaceStatus("chat-store-unsubscribe");

    const listener = mock(() => {});
    const unsubscribe = subscribeChatWorkspaceStatus(
      "chat-store-unsubscribe",
      listener,
    );

    unsubscribe();

    setChatWorkspaceStatus("chat-store-unsubscribe", {
      status: "setting-up",
      message: "Setting up workspace...",
    });

    expect(listener).not.toHaveBeenCalled();

    clearChatWorkspaceStatus("chat-store-unsubscribe");
  });
});
