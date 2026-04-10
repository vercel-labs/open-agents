import { NextResponse } from "next/server";
import { getGitHubAccount } from "@/lib/db/accounts";
import { getInstallationsByUserId } from "@/lib/db/installations";
import type { GitHubConnectionStatusResponse } from "@/lib/github/connection-status";
import {
  isGitHubInstallationsAuthError,
  syncUserInstallations,
} from "@/lib/github/installations-sync";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { getServerSession } from "@/lib/session/get-server-session";

export async function GET() {
  const session = await getServerSession();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const [ghAccount, installations] = await Promise.all([
    getGitHubAccount(session.user.id),
    getInstallationsByUserId(session.user.id),
  ]);

  if (!ghAccount) {
    return NextResponse.json({
      status: "not_connected",
      reason: null,
      hasInstallations: installations.length > 0,
      syncedInstallationsCount: installations.length,
    } satisfies GitHubConnectionStatusResponse);
  }

  const token = await getUserGitHubToken(session.user.id);
  if (!token) {
    return NextResponse.json({
      status: "reconnect_required",
      reason: "token_unavailable",
      hasInstallations: installations.length > 0,
      syncedInstallationsCount: null,
    } satisfies GitHubConnectionStatusResponse);
  }

  try {
    const syncedInstallationsCount = await syncUserInstallations(
      session.user.id,
      token,
    );
    const reconnectRequired =
      installations.length > 0 && syncedInstallationsCount === 0;

    return NextResponse.json({
      status: reconnectRequired ? "reconnect_required" : "connected",
      reason: reconnectRequired ? "installations_missing" : null,
      hasInstallations: syncedInstallationsCount > 0,
      syncedInstallationsCount,
    } satisfies GitHubConnectionStatusResponse);
  } catch (error) {
    if (isGitHubInstallationsAuthError(error)) {
      return NextResponse.json({
        status: "reconnect_required",
        reason: "sync_auth_failed",
        hasInstallations: installations.length > 0,
        syncedInstallationsCount: null,
      } satisfies GitHubConnectionStatusResponse);
    }

    console.error("Failed to validate GitHub connection status:", error);

    return NextResponse.json({
      status: "connected",
      reason: null,
      hasInstallations: installations.length > 0,
      syncedInstallationsCount: installations.length,
    } satisfies GitHubConnectionStatusResponse);
  }
}
