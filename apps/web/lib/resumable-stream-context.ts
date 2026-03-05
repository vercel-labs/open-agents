import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream/ioredis";
import { createChunkedPublisherAdapter } from "./chunked-publisher-adapter";
import { createRedisClient, isRedisConfigured } from "./redis";

type RedisResumableStreamContext = Pick<
  ReturnType<typeof createResumableStreamContext>,
  "createNewResumableStream" | "resumeExistingStream"
>;

const disabledResumableStreamContext: RedisResumableStreamContext = {
  createNewResumableStream: async (_streamId, streamFactory) => streamFactory(),
  resumeExistingStream: async () => null,
};

function createRedisResumableStreamContext(): RedisResumableStreamContext {
  const publisher = createRedisClient();
  const subscriber = createRedisClient();

  return createResumableStreamContext({
    waitUntil: after,
    publisher: createChunkedPublisherAdapter(publisher),
    subscriber,
  });
}

export const resumableStreamContext = isRedisConfigured()
  ? createRedisResumableStreamContext()
  : disabledResumableStreamContext;
