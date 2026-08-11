import { describe, expect, test } from "bun:test";
import { ensureGatewayApiKeyEnv, resolveGatewayApiKey } from "./auth";

describe("harness auth", () => {
  test("prefers an explicit AI Gateway API key", () => {
    expect(
      resolveGatewayApiKey({
        AI_GATEWAY_API_KEY: "gateway-key",
        VERCEL_OIDC_TOKEN: "oidc-token",
      }),
    ).toBe("gateway-key");
  });

  test("promotes an existing Vercel OIDC token to the gateway key", async () => {
    const env: NodeJS.ProcessEnv = {
      VERCEL_OIDC_TOKEN: "oidc-token",
    };

    await expect(ensureGatewayApiKeyEnv(env)).resolves.toBe("oidc-token");
    expect(env.AI_GATEWAY_API_KEY).toBe("oidc-token");
  });

  test("keeps an explicitly configured gateway key", async () => {
    const env: NodeJS.ProcessEnv = {
      AI_GATEWAY_API_KEY: "explicit-key",
      VERCEL_OIDC_TOKEN: "oidc-token",
    };

    await expect(ensureGatewayApiKeyEnv(env)).resolves.toBe("explicit-key");
    expect(env.AI_GATEWAY_API_KEY).toBe("explicit-key");
  });
});
