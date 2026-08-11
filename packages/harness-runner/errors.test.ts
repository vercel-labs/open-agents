import { describe, expect, test } from "bun:test";
import { classifyHarnessErrorCode } from "./errors.ts";

describe("classifyHarnessErrorCode", () => {
  test("classifies a missing bridge dependency", () => {
    expect(
      classifyHarnessErrorCode(
        "Error: Cannot find package 'ws' imported from /tmp/bridge/index.mjs",
      ),
    ).toBe("missing-ws-module");
  });

  test("classifies rejected AI Gateway credentials", () => {
    expect(
      classifyHarnessErrorCode(
        "Authentication failed: AI Gateway rejected AI_GATEWAY_API_KEY",
      ),
    ).toBe("gateway-auth-failed");
  });

  test("classifies a bridge that never became ready", () => {
    expect(
      classifyHarnessErrorCode(
        "Bridge process exited without becoming ready (exit code 1)",
      ),
    ).toBe("bridge-not-ready");
  });

  test("returns undefined for unknown or missing reasons", () => {
    expect(classifyHarnessErrorCode(undefined)).toBeUndefined();
    expect(classifyHarnessErrorCode("stop")).toBeUndefined();
    expect(
      classifyHarnessErrorCode("Authentication failed: bad OpenAI key"),
    ).toBeUndefined();
  });
});
