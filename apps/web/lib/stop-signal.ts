import { createRedisClient } from "@/lib/redis";
import type Redis from "ioredis";

/**
 * Shared Redis subscriber for stop signals across all concurrent chats.
 *
 * Instead of creating one Redis connection per active chat, this module
 * maintains a single subscriber that routes messages by channel to
 * registered callbacks.
 */

type StopCallback = () => void;

let subscriber: Redis | null = null;
const listeners = new Map<string, Set<StopCallback>>();

function getSubscriber(): Redis {
  if (!subscriber) {
    subscriber = createRedisClient();
    subscriber.on("message", (channel: string) => {
      const callbacks = listeners.get(channel);
      if (!callbacks) return;
      for (const cb of callbacks) {
        cb();
      }
    });
  }
  return subscriber;
}

function channelFor(chatId: string): string {
  return `stop:${chatId}`;
}

/**
 * Subscribe to the stop signal for a given chat.
 * Returns an unsubscribe function that cleans up the listener.
 */
export async function onStopSignal(
  chatId: string,
  callback: StopCallback,
): Promise<() => void> {
  const channel = channelFor(chatId);
  const sub = getSubscriber();

  let callbacks = listeners.get(channel);
  if (!callbacks) {
    callbacks = new Set();
    listeners.set(channel, callbacks);
    await sub.subscribe(channel);
  }
  callbacks.add(callback);

  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    callbacks!.delete(callback);
    // If no more listeners on this channel, unsubscribe from Redis
    if (callbacks!.size === 0) {
      listeners.delete(channel);
      sub.unsubscribe(channel).catch(() => {});
    }
  };
}
