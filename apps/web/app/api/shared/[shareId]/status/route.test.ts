import { beforeEach, describe, expect, mock, test } from "bun:test";

let shareRecord: { id: string; chatId: string } | null = {
  id: "share-1",
  chatId: "chat-1",
};

let chatRecord: {
  id: string;
  activeStreamId: string | null;
} | null = {
  id: "chat-1",
  activeStreamId: null,
};

let latestUserMessageCreatedAt: Date | null = new Date("2025-01-01T00:00:00Z");
let latestUserMessageLookupCount = 0;

mock.module("@/lib/db/sessions-cache", () => ({
  getShareByIdCached: async () => shareRecord,
  getSessionByIdCached: async () => null,
}));

mock.module("@/lib/db/sessions", () => ({
  getChatById: async () => chatRecord,
  getLatestUserMessageCreatedAt: async () => {
    latestUserMessageLookupCount += 1;
    return latestUserMessageCreatedAt;
  },
}));

const routeModulePromise = import("./route");

function makeRequest() {
  return new Request("http://localhost/api/shared/share-1/status");
}

function makeContext(shareId = "share-1") {
  return { params: Promise.resolve({ shareId }) };
}

describe("GET /api/shared/:shareId/status", () => {
  beforeEach(() => {
    shareRecord = { id: "share-1", chatId: "chat-1" };
    chatRecord = { id: "chat-1", activeStreamId: null };
    latestUserMessageCreatedAt = new Date("2025-01-01T00:00:00Z");
    latestUserMessageLookupCount = 0;
  });

  test("returns 404 when share does not exist", async () => {
    shareRecord = null;
    const { GET } = await routeModulePromise;
    const res = await GET(makeRequest(), makeContext("missing"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  test("returns 404 when chat does not exist", async () => {
    chatRecord = null;
    const { GET } = await routeModulePromise;
    const res = await GET(makeRequest(), makeContext());
    expect(res.status).toBe(404);
  });

  test("returns isStreaming=false for idle chat", async () => {
    const { GET } = await routeModulePromise;
    const res = await GET(makeRequest(), makeContext());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isStreaming).toBe(false);
    expect(body.startedAt).toBeNull();
    expect(latestUserMessageLookupCount).toBe(0);
  });

  test("returns isStreaming=true with startedAt for active chat", async () => {
    chatRecord = { id: "chat-1", activeStreamId: "stream-xyz" };
    const { GET } = await routeModulePromise;
    const res = await GET(makeRequest(), makeContext());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isStreaming).toBe(true);
    expect(body.startedAt).toBe("2025-01-01T00:00:00.000Z");
    expect(latestUserMessageLookupCount).toBe(1);
  });

  test("returns startedAt=null when active but no user messages", async () => {
    chatRecord = { id: "chat-1", activeStreamId: "stream-xyz" };
    latestUserMessageCreatedAt = null;
    const { GET } = await routeModulePromise;
    const res = await GET(makeRequest(), makeContext());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isStreaming).toBe(true);
    expect(body.startedAt).toBeNull();
    expect(latestUserMessageLookupCount).toBe(1);
  });
});
