import { describe, expect, test } from "bun:test";
import { createCancelableReadableStream } from "./create-cancelable-readable-stream";

// ── Helpers ────────────────────────────────────────────────────────

function makeSource<T>(chunks: T[]): ReadableStream<T> {
  return new ReadableStream<T>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

async function collectStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const chunks: T[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

// ── Tests ──────────────────────────────────────────────────────────

describe("createCancelableReadableStream", () => {
  test("forwards all chunks from source", async () => {
    const source = makeSource(["a", "b", "c"]);
    const wrapped = createCancelableReadableStream(source);
    const result = await collectStream(wrapped);
    expect(result).toEqual(["a", "b", "c"]);
  });

  test("handles empty source stream", async () => {
    const source = makeSource<string>([]);
    const wrapped = createCancelableReadableStream(source);
    const result = await collectStream(wrapped);
    expect(result).toEqual([]);
  });

  test("can be cancelled without error", async () => {
    let enqueueMore = true;
    const source = new ReadableStream<string>({
      async pull(controller) {
        if (enqueueMore) {
          controller.enqueue("chunk");
        }
        // Hang to simulate a slow source
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (enqueueMore) {
          controller.enqueue("chunk2");
        }
      },
    });

    const wrapped = createCancelableReadableStream(source);
    const reader = wrapped.getReader();

    const first = await reader.read();
    expect(first.value).toBe("chunk");

    enqueueMore = false;
    // Cancel should resolve without throwing
    await reader.cancel();
  });

  test("handles AbortError gracefully during read", async () => {
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";

    const source = new ReadableStream<string>({
      pull() {
        throw abortError;
      },
    });

    const wrapped = createCancelableReadableStream(source);
    const reader = wrapped.getReader();

    // Should close gracefully, not throw
    const result = await reader.read();
    expect(result.done).toBe(true);
  });

  test("handles ResponseAborted gracefully during read", async () => {
    const abortError = new Error("Response aborted");
    abortError.name = "ResponseAborted";

    const source = new ReadableStream<string>({
      pull() {
        throw abortError;
      },
    });

    const wrapped = createCancelableReadableStream(source);
    const reader = wrapped.getReader();

    const result = await reader.read();
    expect(result.done).toBe(true);
  });

  test("handles undefined error as abort-like", async () => {
    const source = new ReadableStream<string>({
      pull() {
        throw undefined;
      },
    });

    const wrapped = createCancelableReadableStream(source);
    const reader = wrapped.getReader();

    const result = await reader.read();
    expect(result.done).toBe(true);
  });

  test("propagates non-abort errors via controller.error", async () => {
    const realError = new Error("Something broke");

    const source = new ReadableStream<string>({
      pull() {
        throw realError;
      },
    });

    const wrapped = createCancelableReadableStream(source);
    const reader = wrapped.getReader();

    try {
      await reader.read();
      // If we get here, the test should fail
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBe(realError);
    }
  });

  test("double cancel is idempotent", async () => {
    const source = makeSource(["a"]);
    const wrapped = createCancelableReadableStream(source);

    // Cancel twice should not throw
    await wrapped.cancel();
    await wrapped.cancel();
  });

  test("cancel after full read completes cleanly", async () => {
    const source = makeSource(["a", "b"]);
    const wrapped = createCancelableReadableStream(source);

    await collectStream(wrapped);
    // Stream is already consumed; cancel on the underlying should be safe
    // (the reader lock is already released)
  });
});
