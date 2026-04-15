/** @jsxImportSource chat */

import { Chat, ConsoleLogger } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createIoRedisState } from "@chat-adapter/state-ioredis";
import { getRedisUrl } from "@/lib/redis";

const logger = new ConsoleLogger("info");

export const bot = new Chat({
  userName: "benji",
  adapters: {
    slack: createSlackAdapter(),
  },
  state: createIoRedisState({
    url: getRedisUrl() ?? "redis://localhost:6379",
    logger,
  }),
});

bot.onNewMention(async (thread) => {
  await thread.subscribe();
  await thread.post("Hello! I'm listening to this thread now.");
});

bot.onSubscribedMessage(async (thread, message) => {
  await thread.post(`You said: ${message.text}`);
});
