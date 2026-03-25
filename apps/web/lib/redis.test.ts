import { describe, expect, test } from "bun:test";
import { getRedisConnectionOptions } from "./redis";

describe("getRedisConnectionOptions", () => {
  test("parses bare host and port values without requiring a scheme", () => {
    expect(getRedisConnectionOptions("localhost:6379")).toEqual({
      host: "localhost",
      port: 6379,
    });
  });

  test("parses secure redis URLs with auth, db, and query parameters", () => {
    expect(
      getRedisConnectionOptions(
        "rediss://user%20name:pa%40ss@[::1]:6380/2?family=6&connectionName=skills-cache",
      ),
    ).toEqual({
      username: "user name",
      password: "pa@ss",
      host: "::1",
      port: 6380,
      db: 2,
      family: 6,
      connectionName: "skills-cache",
      tls: {},
    });
  });

  test("preserves explicit tls query parameters for secure redis URLs", () => {
    expect(
      getRedisConnectionOptions(
        "rediss://localhost:6379?tls=RedisCloudFixed&connectionName=skills-cache",
      ),
    ).toEqual({
      host: "localhost",
      port: 6379,
      tls: "RedisCloudFixed",
      connectionName: "skills-cache",
    });
  });

  test("parses unix socket paths and query defaults", () => {
    expect(
      getRedisConnectionOptions(
        "/tmp/redis.sock?db=1&connectionName=skills-cache",
      ),
    ).toEqual({
      path: "/tmp/redis.sock",
      db: 1,
      connectionName: "skills-cache",
    });
  });

  test("does not let query params override explicit host or db values", () => {
    expect(
      getRedisConnectionOptions(
        "redis://localhost:6379/3?db=1&host=example.com&connectionName=skills-cache",
      ),
    ).toEqual({
      host: "localhost",
      port: 6379,
      db: 3,
      connectionName: "skills-cache",
    });
  });
});
