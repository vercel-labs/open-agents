export type GitHubConnectionStatus =
  | "not_connected"
  | "connected"
  | "reconnect_required";

export type GitHubConnectionReason =
  | "token_unavailable"
  | "installations_missing"
  | "sync_auth_failed";

export interface GitHubConnectionStatusResponse {
  status: GitHubConnectionStatus;
  reason: GitHubConnectionReason | null;
  hasInstallations: boolean;
  syncedInstallationsCount: number | null;
}

export function buildGitHubReconnectUrl(next: string): string {
  const params = new URLSearchParams({ step: "github", next });
  return `/get-started?${params.toString()}`;
}
