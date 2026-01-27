import { getApiUrl, getWebAppUrl } from "./config";
import { saveCredentials, type Credentials } from "./credentials";

/**
 * Response from the device code endpoint
 */
interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

/**
 * Response from the token polling endpoint
 */
interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number | null;
  error?: string;
  error_description?: string;
}

/**
 * Response from the user info endpoint
 */
interface UserInfoResponse {
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export interface DeviceFlowStartResult {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

/**
 * Start the device code flow
 */
export async function startDeviceFlow(): Promise<DeviceFlowStartResult> {
  const response = await fetch(getApiUrl("/api/cli/auth/device"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to start device flow: ${text}`);
  }

  const data = (await response.json()) as DeviceCodeResponse;

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    verificationUriComplete: data.verification_uri_complete,
    expiresIn: data.expires_in,
    interval: data.interval,
  };
}

export type PollResult =
  | { status: "pending" }
  | { status: "success"; credentials: Credentials }
  | { status: "expired" }
  | { status: "error"; error: string };

/**
 * Poll for the token (single poll attempt)
 */
export async function pollForToken(deviceCode: string): Promise<PollResult> {
  const response = await fetch(getApiUrl("/api/cli/auth/token"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_code: deviceCode }),
  });

  const data = (await response.json()) as TokenResponse;

  if (data.error === "authorization_pending") {
    return { status: "pending" };
  }

  if (data.error === "expired_token") {
    return { status: "expired" };
  }

  if (data.error) {
    return { status: "error", error: data.error_description || data.error };
  }

  if (!data.access_token) {
    return { status: "error", error: "No access token in response" };
  }

  // Get user info to store with credentials
  const userInfo = await fetchUserInfo(data.access_token);
  if (!userInfo) {
    return { status: "error", error: "Failed to fetch user info" };
  }

  // Calculate expiry date
  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000).toISOString()
    : null;

  const credentials: Credentials = {
    token: data.access_token,
    userId: userInfo.id,
    username: userInfo.username,
    expiresAt,
  };

  // Save credentials
  await saveCredentials(credentials);

  return { status: "success", credentials };
}

/**
 * Fetch user info using the access token
 */
async function fetchUserInfo(
  accessToken: string,
): Promise<UserInfoResponse | null> {
  try {
    const response = await fetch(getApiUrl("/api/cli/auth/me"), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as UserInfoResponse;
  } catch {
    return null;
  }
}

/**
 * Poll for token with retries until success, expiry, or timeout
 */
export async function waitForAuthorization(
  deviceCode: string,
  interval: number,
  expiresIn: number,
  onPoll?: () => void,
): Promise<PollResult> {
  const deadline = Date.now() + expiresIn * 1000;
  const pollInterval = interval * 1000;

  while (Date.now() < deadline) {
    onPoll?.();

    const result = await pollForToken(deviceCode);

    if (result.status !== "pending") {
      return result;
    }

    // Wait for the poll interval
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return { status: "expired" };
}

/**
 * Open the verification URL in the default browser
 */
export async function openBrowser(url: string): Promise<boolean> {
  try {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);

    const platform = process.platform;

    if (platform === "darwin") {
      await execAsync(`open "${url}"`);
    } else if (platform === "win32") {
      await execAsync(`start "${url}"`);
    } else {
      // Linux and others
      await execAsync(`xdg-open "${url}"`);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Get the web app URL (for display purposes)
 */
export function getWebUrl(): string {
  return getWebAppUrl();
}
