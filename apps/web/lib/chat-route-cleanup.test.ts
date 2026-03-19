import { describe, expect, mock, test } from "bun:test";

const spies = {
  abortChatInstanceTransport: mock((_chatId: string) => {}),
  removeChatInstance: mock((_chatId: string) => {}),
};

mock.module("@/lib/chat-instance-manager", () => ({
  abortChatInstanceTransport: spies.abortChatInstanceTransport,
  removeChatInstance: spies.removeChatInstance,
}));

const cleanupModulePromise = import("./chat-route-cleanup");

describe("cleanupChatRouteOnUnmount", () => {
  test("aborts local transport and removes chat instance", async () => {
    const { cleanupChatRouteOnUnmount } = await cleanupModulePromise;

    const calls: string[] = [];
    const abortTransport = mock((chatId: string) => {
      calls.push(`abort:${chatId}`);
    });
    const removeInstance = mock((chatId: string) => {
      calls.push(`remove:${chatId}`);
    });

    cleanupChatRouteOnUnmount("chat-123", {
      abortTransport,
      removeInstance,
    });

    expect(abortTransport).toHaveBeenCalledWith("chat-123");
    expect(removeInstance).toHaveBeenCalledWith("chat-123");
    expect(calls).toEqual(["abort:chat-123", "remove:chat-123"]);
  });

  test("never issues a server stop signal during route teardown", async () => {
    const { cleanupChatRouteOnUnmount } = await cleanupModulePromise;

    const abortTransport = mock((_chatId: string) => {});
    const removeInstance = mock((_chatId: string) => {});
    const stopStream = mock((_chatId: string) => {});

    cleanupChatRouteOnUnmount("chat-456", {
      abortTransport,
      removeInstance,
      stopStream,
    });

    expect(abortTransport).toHaveBeenCalledTimes(1);
    expect(removeInstance).toHaveBeenCalledTimes(1);
    expect(stopStream).not.toHaveBeenCalled();
  });
});
