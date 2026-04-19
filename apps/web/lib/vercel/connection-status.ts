export const VERCEL_CONNECTION_STATUS_DEDUPING_INTERVAL_MS = 30_000;

export type VercelConnectionStatus = "connected" | "reconnect_required";

export type VercelConnectionReason =
  | "token_unavailable"
  | "userinfo_auth_failed";

export interface VercelConnectionStatusResponse {
  status: VercelConnectionStatus;
  reason: VercelConnectionReason | null;
}

export function buildVercelReconnectUrl(next: string): string {
  const params = new URLSearchParams({ next });
  return `/api/auth/signin/vercel?${params.toString()}`;
}
