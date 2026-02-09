import Redis from "ioredis";

function getRedisUrl(): string {
  const url = process.env.REDIS_URL ?? process.env.KV_URL;
  if (!url)
    throw new Error("REDIS_URL or KV_URL environment variable is required");
  return url;
}

export function createRedisClient() {
  return new Redis(getRedisUrl());
}
