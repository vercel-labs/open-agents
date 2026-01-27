import { createGateway } from "ai";

export interface ProxyConfig {
  baseUrl: string;
  token: string;
}

/**
 * Create a gateway that routes requests through the web app proxy.
 * This allows authenticated CLI users to use the platform's AI gateway.
 */
export function createProxyGateway(config: ProxyConfig) {
  return createGateway({
    baseURL: `${config.baseUrl}/api/ai-proxy`,
    apiKey: config.token,
  });
}
