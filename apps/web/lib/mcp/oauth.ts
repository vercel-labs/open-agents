import crypto from "node:crypto";
import { assertSafeUrl } from "./validate";

// ── Types ──────────────────────────────────────────────────────────────────

export interface OAuthServerMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
  code_challenge_methods_supported?: string[];
  grant_types_supported?: string[];
  scopes_supported?: string[];
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
}

export interface OAuthClientRegistration {
  clientId: string;
  clientSecret?: string;
}

export interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
}

// ── PKCE ───────────────────────────────────────────────────────────────────

export function generatePKCE(): PKCEChallenge {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function generateState(): string {
  return crypto.randomBytes(32).toString("base64url");
}

// ── Metadata Discovery ─────────────────────────────────────────────────────

export async function discoverOAuthMetadata(
  mcpUrl: string,
): Promise<OAuthServerMetadata> {
  // Per MCP spec: strip path from MCP URL to get authorization base URL
  const baseUrl = new URL(mcpUrl);
  baseUrl.pathname = "";

  const metadataUrl = `${baseUrl.origin}/.well-known/oauth-authorization-server`;

  assertSafeUrl(metadataUrl);

  try {
    const response = await fetch(metadataUrl, {
      headers: { "MCP-Protocol-Version": "2025-03-26" },
      redirect: "error",
    });

    if (response.ok) {
      return (await response.json()) as OAuthServerMetadata;
    }
  } catch {
    // Discovery failed — fall back to defaults
  }

  // Fallback to default endpoints per MCP spec
  return {
    authorization_endpoint: `${baseUrl.origin}/authorize`,
    token_endpoint: `${baseUrl.origin}/token`,
    registration_endpoint: `${baseUrl.origin}/register`,
  };
}

// ── Dynamic Client Registration ─────────────────────────────────────────────

export async function registerOAuthClient(
  registrationEndpoint: string,
  redirectUri: string,
): Promise<OAuthClientRegistration> {
  assertSafeUrl(registrationEndpoint);

  const response = await fetch(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      client_name: "Open Harness",
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Dynamic client registration failed at ${registrationEndpoint} (HTTP ${response.status} ${response.statusText}): ${text || "empty response body"}`,
    );
  }

  const data = (await response.json()) as {
    client_id: string;
    client_secret?: string;
  };

  return {
    clientId: data.client_id,
    clientSecret: data.client_secret,
  };
}

// ── Token Exchange ──────────────────────────────────────────────────────────

export async function exchangeCodeForTokens(params: {
  tokenEndpoint: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
}): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
    client_id: params.clientId,
  });

  if (params.clientSecret) {
    body.set("client_secret", params.clientSecret);
  }

  assertSafeUrl(params.tokenEndpoint);

  const response = await fetch(params.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  return (await response.json()) as OAuthTokenResponse;
}

// ── Token Refresh ───────────────────────────────────────────────────────────

export async function refreshOAuthTokens(params: {
  tokenEndpoint: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId,
  });

  if (params.clientSecret) {
    body.set("client_secret", params.clientSecret);
  }

  assertSafeUrl(params.tokenEndpoint);

  const response = await fetch(params.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Token refresh failed (${response.status}): ${text}`);
  }

  return (await response.json()) as OAuthTokenResponse;
}

// ── Build Authorization URL ─────────────────────────────────────────────────

export function buildAuthorizationUrl(params: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scopes?: string[];
}): string {
  const url = new URL(params.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);

  if (params.scopes && params.scopes.length > 0) {
    url.searchParams.set("scope", params.scopes.join(" "));
  }

  return url.toString();
}
