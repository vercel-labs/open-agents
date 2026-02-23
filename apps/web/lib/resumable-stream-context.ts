import { Redis } from "ioredis";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream/ioredis";
import { createChunkedPublisherAdapter } from "./chunked-publisher-adapter";

function getRedisUrl(): string {
  const url = process.env.REDIS_URL || process.env.KV_URL;
  if (!url) {
    throw new Error(
      "REDIS_URL or KV_URL environment variable is required for resumable streams",
    );
  }
  return url;
}

export const resumableStreamContext = createResumableStreamContext({
  waitUntil: after,
  publisher: createChunkedPublisherAdapter(new Redis(getRedisUrl())),
  subscriber: new Redis(getRedisUrl()),
});
