import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { INTERNAL_API_REJECTED_STATUS } from "./internal-endpoints";
import { signInternalHarnessRequest } from "./internal-request";
import {
  INTERNAL_API_MAX_BODY_BYTES,
  withInternalRouteGuard,
} from "./internal-route";

/**
 * The guard is the layer that has to hold on its own: `proxy.ts` filters the
 * same traffic, but only as an optimization, so every control an internal
 * endpoint depends on is asserted here, against the guard, with nothing in
 * front of it.
 */

const originalSecret = process.env.INTERNAL_HARNESS_SECRET;
const RUNNER_URL = "https://preview.example.com/api/internal/harness-runner";
const BODY = JSON.stringify({ harnessId: "codex" });

beforeEach(() => {
  process.env.INTERNAL_HARNESS_SECRET = "test-internal-harness-secret";
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.INTERNAL_HARNESS_SECRET;
  } else {
    process.env.INTERNAL_HARNESS_SECRET = originalSecret;
  }
});

function createHandler() {
  const handler = mock((_request: Request, _body: string) =>
    Response.json({ ok: true }),
  );
  return { handler, guarded: withInternalRouteGuard(handler) };
}

function sign(body: string, url = RUNNER_URL) {
  return signInternalHarnessRequest({ method: "POST", url, body });
}

function createRequest(
  headers: Record<string, string>,
  init: RequestInit = {},
) {
  return new Request(RUNNER_URL, {
    method: "POST",
    headers,
    body: BODY,
    ...init,
  });
}

describe("withInternalRouteGuard", () => {
  test("runs the handler for a signed POST and hands it the verified body", async () => {
    const { handler, guarded } = createHandler();

    const response = await guarded(
      createRequest({ "x-open-agents-harness-signature": sign(BODY) }),
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[1]).toBe(BODY);
  });

  test("never runs the handler for an unsigned request, or reads its body", async () => {
    const { handler, guarded } = createHandler();
    const request = createRequest({});

    const response = await guarded(request);

    expect(response.status).toBe(INTERNAL_API_REJECTED_STATUS);
    expect(await response.text()).toBe("");
    expect(request.bodyUsed).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  test("never runs the handler for a signature that does not cover the request", async () => {
    const { handler, guarded } = createHandler();

    const tampered = await guarded(
      createRequest({ "x-open-agents-harness-signature": sign(`${BODY} `) }),
    );
    const misdirected = await guarded(
      createRequest({
        "x-open-agents-harness-signature": sign(
          BODY,
          "https://preview.example.com/api/internal/other-runner",
        ),
      }),
    );

    expect(tampered.status).toBe(INTERNAL_API_REJECTED_STATUS);
    expect(misdirected.status).toBe(INTERNAL_API_REJECTED_STATUS);
    expect(handler).not.toHaveBeenCalled();
  });

  test("never runs the handler for a verb the signature was not minted for", async () => {
    // Verb handling is left to Next, which answers `405` for anything a route
    // does not export. The guard does not re-check the method because it does
    // not have to: the method is signed material, so a request that arrives
    // with a different one cannot carry a signature that covers it.
    const { handler, guarded } = createHandler();

    const response = await guarded(
      new Request(RUNNER_URL, {
        method: "GET",
        headers: { "x-open-agents-harness-signature": sign(BODY) },
      }),
    );

    expect(response.status).toBe(INTERNAL_API_REJECTED_STATUS);
    expect(handler).not.toHaveBeenCalled();
  });

  test("answers the rejection status for an unparseable request url", async () => {
    // A route can be reached with a URL the URL parser rejects. There is no
    // path to verify a signature against for one, so it has to fail closed
    // rather than becoming a 500 that says the endpoint is there.
    const { handler, guarded } = createHandler();
    const unparseable = {
      method: "POST",
      url: "not-a-url",
      body: null,
    };

    const unsigned = await guarded({
      ...unparseable,
      headers: new Headers(),
    } as Request);
    const signed = await guarded({
      ...unparseable,
      headers: new Headers({ "x-open-agents-harness-signature": sign("") }),
    } as Request);

    expect(unsigned.status).toBe(INTERNAL_API_REJECTED_STATUS);
    expect(signed.status).toBe(INTERNAL_API_REJECTED_STATUS);
    expect(handler).not.toHaveBeenCalled();
  });

  test("fails closed when INTERNAL_HARNESS_SECRET is unset", async () => {
    const { handler, guarded } = createHandler();
    const request = createRequest({
      "x-open-agents-harness-signature": sign(BODY),
    });
    delete process.env.INTERNAL_HARNESS_SECRET;

    const response = await guarded(request);

    expect(response.status).toBe(INTERNAL_API_REJECTED_STATUS);
    expect(handler).not.toHaveBeenCalled();
  });

  test("rejects an over-cap content-length without reading the body", async () => {
    const { handler, guarded } = createHandler();
    const request = createRequest({
      "x-open-agents-harness-signature": sign(BODY),
      "content-length": String(INTERNAL_API_MAX_BODY_BYTES + 1),
    });

    const response = await guarded(request);

    expect(response.status).toBe(INTERNAL_API_REJECTED_STATUS);
    expect(request.bodyUsed).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  test("rejects a malformed content-length", async () => {
    const { handler, guarded } = createHandler();

    const response = await guarded(
      createRequest({
        "x-open-agents-harness-signature": sign(BODY),
        "content-length": "twelve",
      }),
    );

    expect(response.status).toBe(INTERNAL_API_REJECTED_STATUS);
    expect(handler).not.toHaveBeenCalled();
  });

  test("stops reading a streamed body once it passes the cap", async () => {
    const { handler, guarded } = createHandler();
    const chunkBytes = 1024 * 1024;
    const chunkCount = 64;
    let pulledChunks = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulledChunks >= chunkCount) {
          controller.close();
          return;
        }
        pulledChunks += 1;
        controller.enqueue(new Uint8Array(chunkBytes));
      },
    });

    const response = await guarded(
      new Request(RUNNER_URL, {
        method: "POST",
        // Syntactically plausible, and no content-length to trust: the cap has
        // to be enforced against the bytes actually arriving.
        headers: { "x-open-agents-harness-signature": "1700000000.deadbeef" },
        body: stream,
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
    );

    expect(response.status).toBe(INTERNAL_API_REJECTED_STATUS);
    expect(pulledChunks).toBeLessThanOrEqual(
      INTERNAL_API_MAX_BODY_BYTES / chunkBytes + 1,
    );
    expect(pulledChunks).toBeLessThan(chunkCount);
    expect(handler).not.toHaveBeenCalled();
  });

  test("marks a handler's response uncacheable", async () => {
    const guarded = withInternalRouteGuard(() => new Response("streamed"));

    const response = await guarded(
      createRequest({ "x-open-agents-harness-signature": sign(BODY) }),
    );

    expect(await response.text()).toBe("streamed");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
