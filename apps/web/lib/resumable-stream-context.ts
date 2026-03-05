import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream/ioredis";
import { createChunkedPublisherAdapter } from "./chunked-publisher-adapter";
import {
  createRedisClient,
  isRedisConfigured,
  warnRedisDisabled,
} from "./redis";

type RedisResumableStreamContext = Pick<
  ReturnType<typeof createResumableStreamContext>,
  "createNewResumableStream" | "resumeExistingStream"
>;

const disabledResumableStreamContext: RedisResumableStreamContext = {
  createNewResumableStream: async (_streamId, streamFactory) => {
    warnRedisDisabled("Resumable stream persistence");
    return streamFactory();
  },
  resumeExistingStream: async () => {
    warnRedisDisabled("Resumable stream resume");
    return null;
  },
};

function createRedisResumableStreamContext(): RedisResumableStreamContext {
  const publisher = createRedisClient("resumable-stream-publisher");
  const subscriber = createRedisClient("resumable-stream-subscriber");

  return createResumableStreamContext({
    waitUntil: after,
    publisher: createChunkedPublisherAdapter(publisher),
    subscriber,
  });
}

export const resumableStreamContext = isRedisConfigured()
  ? createRedisResumableStreamContext()
  : disabledResumableStreamContext;
