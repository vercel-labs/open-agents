/**
 * Maximum characters per replay publish frame. Conservative limit to stay
 * well under Upstash's 10 MB request size cap even with multi-byte content.
 * At worst case (4 bytes per char), a single frame is ~1 MB.
 */
export const MAX_REPLAY_FRAME_CHARS = 256 * 1024;

/** Redis-like client interface covering the methods the publisher adapter needs. */
export interface RedisLikeClient {
  publish(channel: string, message: string): Promise<number>;
  set(key: string, value: string, ...args: unknown[]): Promise<"OK" | unknown>;
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
}

/**
 * Creates a publisher adapter that chunks large PUBLISH payloads into
 * sequential frames to avoid exceeding Upstash's 10 MB request size limit
 * during stream replay.
 *
 * Small publishes (live chunks, done sentinel) pass through unchanged.
 * Only replay payloads that exceed the frame cap are split.
 */
export function createChunkedPublisherAdapter(client: RedisLikeClient) {
  return {
    connect: () => Promise.resolve(),

    publish: async (
      channel: string,
      message: string,
    ): Promise<number | unknown> => {
      if (message.length <= MAX_REPLAY_FRAME_CHARS) {
        return client.publish(channel, message);
      }

      // Dispatch all frames synchronously so they enter the ioredis pipeline
      // in order BEFORE this async function yields. This prevents the caller
      // from interleaving a DONE_MESSAGE publish between frames.
      let offset = 0;
      const framePromises: Array<Promise<number>> = [];

      while (offset < message.length) {
        const frame = message.slice(offset, offset + MAX_REPLAY_FRAME_CHARS);
        framePromises.push(client.publish(channel, frame));
        offset += frame.length;
      }

      const results = await Promise.all(framePromises);
      return results[results.length - 1];
    },

    set: (key: string, value: string, options?: { EX?: number }) => {
      if (options?.EX) {
        return client.set(key, value, "EX", options.EX);
      }
      return client.set(key, value);
    },

    get: (key: string) => client.get(key),
    incr: (key: string) => client.incr(key),
  };
}
