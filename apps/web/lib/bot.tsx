/** @jsxImportSource chat */

import { Chat, ConsoleLogger, toAiMessages } from "chat";
import type { Thread } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createIoRedisState } from "@chat-adapter/state-ioredis";
import { getRedisUrl } from "@/lib/redis";
import { slackAgent } from "@/lib/agents/slack-agent";

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

async function handleMessage(thread: Thread) {
  const messages = [];
  for await (const msg of thread.allMessages) {
    messages.push(msg);
  }

  const history = await toAiMessages(messages, { includeNames: true });
  const result = await slackAgent.stream({ prompt: history });
  await thread.post(result.fullStream);
}

bot.onNewMention(async (thread) => {
  await thread.subscribe();
  await handleMessage(thread);
});

bot.onSubscribedMessage(async (thread) => {
  await handleMessage(thread);
});
