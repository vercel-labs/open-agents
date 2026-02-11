import { beforeEach, describe, expect, mock, test } from "bun:test";

type UpsertMode = "inserted" | "updated" | "conflict";

let upsertMode: UpsertMode = "inserted";

const fakeInsertedMessage = {
  id: "message-1",
  chatId: "chat-1",
  role: "assistant" as const,
  parts: { id: "message-1", role: "assistant", parts: [] },
  createdAt: new Date(),
};

const fakeDb = {
  transaction: async <T>(
    callback: (tx: {
      insert: (table: unknown) => {
        values: (input: unknown) => {
          onConflictDoNothing: (config: unknown) => {
            returning: () => Promise<(typeof fakeInsertedMessage)[]>;
          };
        };
      };
      update: (table: unknown) => {
        set: (input: unknown) => {
          where: (condition: unknown) => {
            returning: () => Promise<(typeof fakeInsertedMessage)[]>;
          };
        };
      };
    }) => Promise<T>,
  ) => {
    const tx = {
      insert: (_table: unknown) => ({
        values: (_input: unknown) => ({
          onConflictDoNothing: (_config: unknown) => ({
            returning: async () =>
              upsertMode === "inserted" ? [fakeInsertedMessage] : [],
          }),
        }),
      }),
      update: (_table: unknown) => ({
        set: (_input: unknown) => ({
          where: (_condition: unknown) => ({
            returning: async () =>
              upsertMode === "updated" ? [fakeInsertedMessage] : [],
          }),
        }),
      }),
    };

    return callback(tx);
  },
};

mock.module("./client", () => ({
  db: fakeDb,
}));

const sessionsModulePromise = import("./sessions");

describe("upsertChatMessageScoped", () => {
  beforeEach(() => {
    upsertMode = "inserted";
  });

  test("returns inserted when no existing row conflicts", async () => {
    const { upsertChatMessageScoped } = await sessionsModulePromise;
    upsertMode = "inserted";

    const result = await upsertChatMessageScoped({
      id: "message-1",
      chatId: "chat-1",
      role: "assistant",
      parts: { id: "message-1", role: "assistant", parts: [] },
    });

    expect(result.status).toBe("inserted");
  });

  test("returns updated when id exists in same chat and role", async () => {
    const { upsertChatMessageScoped } = await sessionsModulePromise;
    upsertMode = "updated";

    const result = await upsertChatMessageScoped({
      id: "message-1",
      chatId: "chat-1",
      role: "assistant",
      parts: { id: "message-1", role: "assistant", parts: [{ type: "text" }] },
    });

    expect(result.status).toBe("updated");
  });

  test("returns conflict when id exists for different chat/role scope", async () => {
    const { upsertChatMessageScoped } = await sessionsModulePromise;
    upsertMode = "conflict";

    const result = await upsertChatMessageScoped({
      id: "message-1",
      chatId: "chat-1",
      role: "assistant",
      parts: { id: "message-1", role: "assistant", parts: [{ type: "text" }] },
    });

    expect(result.status).toBe("conflict");
  });
});
