import { describe, expect, test } from "bun:test";
import { isStreamAlreadyCompletedError } from "./stream-conflict";

describe("isStreamAlreadyCompletedError", () => {
  test("matches the durable stream close conflict", () => {
    expect(
      isStreamAlreadyCompletedError(
        new Error(
          'Stream close failed: HTTP 409 (PUT https://vercel-workflow.com/api/v2/runs/wrun_1/stream/strm_1_user; x-vercel-id=iad1): {"success":false,"error":"conflict","message":"Stream \\"strm_1_user\\" is already completed"}',
        ),
      ),
    ).toBeTrue();
  });

  test("matches the durable stream write conflict", () => {
    expect(
      isStreamAlreadyCompletedError(
        new Error(
          'Stream write failed: HTTP 409 (PUT https://vercel-workflow.com/api/v2/runs/wrun_1/stream/strm_1_user): {"success":false,"error":"conflict","message":"Stream \\"strm_1_user\\" is already completed"}',
        ),
      ),
    ).toBeTrue();
  });

  test("ignores other stream failures", () => {
    expect(
      isStreamAlreadyCompletedError(
        new Error("Stream close failed: HTTP 500 (PUT https://...): oops"),
      ),
    ).toBeFalse();
    expect(
      isStreamAlreadyCompletedError(
        new Error("Stream write failed: HTTP 409 (PUT https://...): other"),
      ),
    ).toBeFalse();
    expect(isStreamAlreadyCompletedError("already completed")).toBeFalse();
  });
});
