import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream/ioredis";

export const resumableStreamContext = createResumableStreamContext({
  waitUntil: after,
});
