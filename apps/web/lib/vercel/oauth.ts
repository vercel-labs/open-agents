import crypto from "crypto";

const VERCEL_AUTHORIZE_URL = "https://vercel.com/oauth/authorize";
const VERCEL_TOKEN_URL = "https://api.vercel.com/login/oauth/token";
const VERCEL_USERINFO_URL = "https://api.vercel.com/login/oauth/userinfo";
const VERCEL_REVOKE_URL = "https://api.vercel.com/login/oauth/token/revoke";

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = crypto.createHash("sha256").update(verifier).digest();
  return digest.toString("base64url");
}

export function getVercelAuthorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const searchParams = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    scope: "openid email profile offline_access",
    response_type: "code",
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    state: params.state,
  });
  return `${VERCEL_AUTHORIZE_URL}?${searchParams.toString()}`;
}

interface VercelTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export async function exchangeVercelCode(params: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<VercelTokenResponse> {
  const response = await fetch(VERCEL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      code_verifier: params.codeVerifier,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vercel token exchange failed: ${text}`);
  }

  return response.json() as Promise<VercelTokenResponse>;
}

export async function refreshVercelToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<VercelTokenResponse> {
  const response = await fetch(VERCEL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vercel token refresh failed: ${text}`);
  }

  return response.json() as Promise<VercelTokenResponse>;
}

export interface VercelUserInfo {
  sub: string;
  name?: string;
  email?: string;
  preferred_username?: string;
  picture?: string;
}

export async function getVercelUserInfo(
  accessToken: string,
): Promise<VercelUserInfo> {
  const response = await fetch(VERCEL_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vercel userinfo fetch failed: ${text}`);
  }

  return response.json() as Promise<VercelUserInfo>;
}

export async function revokeVercelToken(params: {
  token: string;
  clientId: string;
  clientSecret: string;
}): Promise<void> {
  await fetch(VERCEL_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: params.token,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    }),
  });
}
