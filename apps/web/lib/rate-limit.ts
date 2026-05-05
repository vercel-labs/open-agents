import Redis, { type RedisOptions } from "ioredis";
import { getRedisConnectionOptions, getRedisUrl } from "./redis";

type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

const DEFAULT_RATE_LIMIT_TIMEOUT_MS = 1000;

let sharedRedisClient: Redis | null | undefined;

function getRateLimitTimeoutMs(): number {
  const configuredTimeoutMs = process.env.RATE_LIMIT_TIMEOUT_MS;
  if (!configuredTimeoutMs) {
    return DEFAULT_RATE_LIMIT_TIMEOUT_MS;
  }

  const timeoutMs = Number.parseInt(configuredTimeoutMs, 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_RATE_LIMIT_TIMEOUT_MS;
  }

  return timeoutMs;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(
        new Error(`Redis rate limit check timed out after ${timeoutMs}ms`),
      );
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

function getSharedRedisClient(): Redis | null {
  if (sharedRedisClient !== undefined) {
    return sharedRedisClient;
  }

  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    sharedRedisClient = null;
    return sharedRedisClient;
  }

  sharedRedisClient = new Redis({
    ...(getRedisConnectionOptions(redisUrl) as RedisOptions),
    connectTimeout: 500,
    maxRetriesPerRequest: 1,
  });
  sharedRedisClient.on("error", (error) => {
    console.error("[redis] rate-limit error:", error);
  });
  return sharedRedisClient;
}

function resetRedisClient(): void {
  sharedRedisClient?.disconnect();
  sharedRedisClient = undefined;
}

function rateLimitResponse(retryAfterMs: number): Response {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));

  return Response.json(
    { error: "Too many requests" },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    },
  );
}

async function checkRedisRateLimit(
  client: Redis,
  options: RateLimitOptions,
): Promise<Response | null> {
  const key = `rate-limit:${options.key}`;
  const count = await client
    .multi()
    .incr(key)
    .pexpire(key, options.windowMs, "NX")
    .exec()
    .then((results) => {
      const [incrementResult, expireResult] = results ?? [];
      const [error, value] = incrementResult ?? [];
      if (error) {
        throw error;
      }

      const [expireError] = expireResult ?? [];
      if (expireError) {
        throw expireError;
      }

      const count = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(count)) {
        throw new Error("Redis rate limit increment returned an invalid count");
      }

      return count;
    });

  if (count <= options.limit) {
    return null;
  }

  const ttl = await client.pttl(key);
  return rateLimitResponse(ttl > 0 ? ttl : options.windowMs);
}

function rateLimitUnavailableResponse(): Response | null {
  if (process.env.NODE_ENV !== "production") {
    return null;
  }

  return Response.json(
    { error: "Rate limit unavailable" },
    { status: 503, headers: { "Retry-After": "30" } },
  );
}

export async function checkRateLimit(
  options: RateLimitOptions,
): Promise<Response | null> {
  const redisClient = getSharedRedisClient();
  if (!redisClient) {
    return rateLimitUnavailableResponse();
  }

  try {
    return await withTimeout(
      checkRedisRateLimit(redisClient, options),
      getRateLimitTimeoutMs(),
    );
  } catch (error) {
    resetRedisClient();
    console.error("[rate-limit] Redis check failed:", error);
    return rateLimitUnavailableResponse();
  }
}

export function rateLimitKey(parts: (number | string | null | undefined)[]) {
  return parts.map((part) => String(part ?? "unknown")).join(":");
}
