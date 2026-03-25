import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const originalFetch = globalThis.fetch;
const fetchMock = mock(async () => new Response("unexpected upstream call"));
const routeModulePromise = import("./route");

describe("/api/vercel/projects/[idOrName]/env", () => {
  beforeEach(() => {
    fetchMock.mockClear();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns not found and never proxies decrypted env values to the browser", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET();

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
