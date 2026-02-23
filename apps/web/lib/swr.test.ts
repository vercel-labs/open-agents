import { afterEach, describe, expect, mock, test } from "bun:test";
import { FetchError, fetcher } from "./swr";

// Store the original global fetch so we can restore it.
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// FetchError
// ---------------------------------------------------------------------------
describe("FetchError", () => {
  test("stores status and message", () => {
    const err = new FetchError("Not Found", 404);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("FetchError");
    expect(err.message).toBe("Not Found");
    expect(err.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// fetcher
// ---------------------------------------------------------------------------
describe("fetcher", () => {
  function mockFetch(response: {
    ok: boolean;
    status: number;
    statusText: string;
    json?: () => Promise<unknown>;
  }) {
    globalThis.fetch = mock(() =>
      Promise.resolve(response as Response),
    ) as unknown as typeof fetch;
  }

  test("returns parsed JSON on success", async () => {
    mockFetch({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({ hello: "world" }),
    });

    const data = await fetcher<{ hello: string }>("https://example.com/api");
    expect(data).toEqual({ hello: "world" });
  });

  test("throws FetchError with status on non-OK response", async () => {
    mockFetch({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: () => Promise.resolve({}),
    });

    try {
      await fetcher("https://example.com/api");
      throw new Error("expected fetcher to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FetchError);
      expect((err as FetchError).status).toBe(401);
    }
  });

  test("extracts error message from JSON body", async () => {
    mockFetch({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      json: () => Promise.resolve({ error: "Validation failed" }),
    });

    try {
      await fetcher("https://example.com/api");
      throw new Error("expected fetcher to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FetchError);
      expect((err as FetchError).message).toBe("Validation failed");
      expect((err as FetchError).status).toBe(422);
    }
  });

  test("falls back to statusText when JSON parsing fails", async () => {
    mockFetch({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.reject(new Error("not json")),
    });

    try {
      await fetcher("https://example.com/api");
      throw new Error("expected fetcher to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FetchError);
      expect((err as FetchError).message).toBe("Internal Server Error");
      expect((err as FetchError).status).toBe(500);
    }
  });
});
