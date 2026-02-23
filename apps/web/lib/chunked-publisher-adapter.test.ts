import { describe, expect, test } from "bun:test";
import {
  createChunkedPublisherAdapter,
  MAX_REPLAY_FRAME_CHARS,
  type RedisLikeClient,
} from "./chunked-publisher-adapter";

/** Creates a mock Redis client that records all publish calls. */
function createMockClient() {
  const publishes: Array<{ channel: string; message: string }> = [];

  const client: RedisLikeClient = {
    publish: async (channel: string, message: string) => {
      publishes.push({ channel, message });
      return 1;
    },
    set: async () => "OK",
    get: async () => null,
    incr: async () => 1,
  };

  return { client, publishes };
}

describe("createChunkedPublisherAdapter", () => {
  test("passes small messages through as a single publish", async () => {
    const { client, publishes } = createMockClient();
    const adapter = createChunkedPublisherAdapter(client);

    await adapter.publish("ch", "hello");

    expect(publishes).toHaveLength(1);
    expect(publishes[0]).toEqual({ channel: "ch", message: "hello" });
  });

  test("passes empty string through as a single publish (resume ack)", async () => {
    const { client, publishes } = createMockClient();
    const adapter = createChunkedPublisherAdapter(client);

    await adapter.publish("ch", "");

    expect(publishes).toHaveLength(1);
    expect(publishes[0]).toEqual({ channel: "ch", message: "" });
  });

  test("passes message exactly at the frame limit as a single publish", async () => {
    const { client, publishes } = createMockClient();
    const adapter = createChunkedPublisherAdapter(client);
    const exactMessage = "x".repeat(MAX_REPLAY_FRAME_CHARS);

    await adapter.publish("ch", exactMessage);

    expect(publishes).toHaveLength(1);
    expect(publishes[0]?.message).toBe(exactMessage);
  });

  test("chunks a message one char over the limit into two frames", async () => {
    const { client, publishes } = createMockClient();
    const adapter = createChunkedPublisherAdapter(client);
    const message = "x".repeat(MAX_REPLAY_FRAME_CHARS + 1);

    await adapter.publish("ch", message);

    expect(publishes).toHaveLength(2);
    expect(publishes[0]?.message.length).toBe(MAX_REPLAY_FRAME_CHARS);
    expect(publishes[1]?.message.length).toBe(1);
  });

  test("chunks a large message and reconstructs the original", async () => {
    const { client, publishes } = createMockClient();
    const adapter = createChunkedPublisherAdapter(client);

    // ~12 MB of characters -- well above the 10 MB Upstash limit
    const totalChars = 12 * 1024 * 1024;
    const message = "a".repeat(totalChars);

    await adapter.publish("ch", message);

    const expectedFrames = Math.ceil(totalChars / MAX_REPLAY_FRAME_CHARS);
    expect(publishes).toHaveLength(expectedFrames);

    // Reconstruct and verify byte-for-byte integrity
    const reconstructed = publishes.map((p) => p.message).join("");
    expect(reconstructed).toBe(message);
  });

  test("preserves ordering of frames", async () => {
    const { client, publishes } = createMockClient();
    const adapter = createChunkedPublisherAdapter(client);

    // Build a message with distinct content per frame boundary
    const frameCount = 5;
    const parts = Array.from({ length: frameCount }, (_, i) =>
      String(i).repeat(MAX_REPLAY_FRAME_CHARS),
    );
    const message = parts.join("");

    await adapter.publish("ch", message);

    expect(publishes).toHaveLength(frameCount);
    for (let i = 0; i < frameCount; i++) {
      expect(publishes[i]?.message).toBe(parts[i]);
    }
  });

  test("publishes all frames to the same channel", async () => {
    const { client, publishes } = createMockClient();
    const adapter = createChunkedPublisherAdapter(client);
    const message = "z".repeat(MAX_REPLAY_FRAME_CHARS * 3);

    await adapter.publish("my-channel", message);

    for (const p of publishes) {
      expect(p.channel).toBe("my-channel");
    }
  });

  test("delegates set, get, incr to the underlying client", async () => {
    const { client } = createMockClient();
    const adapter = createChunkedPublisherAdapter(client);

    expect(await adapter.set("k", "v")).toBe("OK");
    expect(await adapter.get("k")).toBe(null);
    expect(await adapter.incr("k")).toBe(1);
  });

  test("dispatches all frames synchronously before yielding", async () => {
    // Simulates the upstream pattern where replay + DONE are dispatched via
    // Promise.all. All replay frames must enter the pipeline before the caller
    // can dispatch DONE, otherwise DONE arrives between frames.
    const callOrder: string[] = [];

    const client: RedisLikeClient = {
      publish: async (_channel: string, message: string) => {
        callOrder.push(message.startsWith("DONE") ? "DONE" : "frame");
        return 1;
      },
      set: async () => "OK",
      get: async () => null,
      incr: async () => 1,
    };
    const adapter = createChunkedPublisherAdapter(client);

    const bigMessage = "x".repeat(MAX_REPLAY_FRAME_CHARS * 3);
    const DONE = "DONE_SENTINEL";

    // Mirror upstream: push both publishes, then Promise.all
    const promises: Array<Promise<number | unknown>> = [];
    promises.push(adapter.publish("ch", bigMessage));
    promises.push(adapter.publish("ch", DONE));
    await Promise.all(promises);

    // All 3 frames must appear before DONE
    expect(callOrder).toEqual(["frame", "frame", "frame", "DONE"]);
  });

  test("set passes EX option correctly", async () => {
    let capturedArgs: unknown[] = [];
    const client: RedisLikeClient = {
      publish: async () => 1,
      set: async (...args: unknown[]) => {
        capturedArgs = args;
        return "OK";
      },
      get: async () => null,
      incr: async () => 1,
    };
    const adapter = createChunkedPublisherAdapter(client);

    await adapter.set("k", "v", { EX: 3600 });

    expect(capturedArgs).toEqual(["k", "v", "EX", 3600]);
  });
});
