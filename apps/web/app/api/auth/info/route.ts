import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { getGitHubAccount } from "@/lib/db/accounts";
import { getInstallationsByUserId } from "@/lib/db/installations";
import { userExists } from "@/lib/db/users";
import { SESSION_COOKIE_NAME } from "@/lib/session/constants";
import { getSessionFromReq } from "@/lib/session/server";
import type { SessionUserInfo } from "@/lib/session/types";
import { getUserVercelToken } from "@/lib/vercel/token";

const UNAUTHENTICATED: SessionUserInfo = { user: undefined };
const VERCEL_USERINFO_URL = "https://api.vercel.com/login/oauth/userinfo";

async function requiresVercelReconnect(userId: string): Promise<boolean> {
  const token = await getUserVercelToken(userId);
  if (!token) {
    return true;
  }

  try {
    const response = await fetch(VERCEL_USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (response.ok) {
      return false;
    }

    if (
      response.status === 400 ||
      response.status === 401 ||
      response.status === 403
    ) {
      return true;
    }

    console.error(
      `Failed to validate Vercel connection status: ${response.status} ${response.statusText}`,
    );
    return false;
  } catch (error) {
    console.error("Failed to validate Vercel connection status:", error);
    return false;
  }
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromReq(req);

  if (!session?.user?.id) {
    return Response.json(UNAUTHENTICATED);
  }

  const vercelReconnectPromise =
    session.authProvider === "vercel"
      ? requiresVercelReconnect(session.user.id)
      : Promise.resolve(false);

  // Run the user-existence check in parallel with the connection queries
  // so there is zero added latency on the happy path.
  const [exists, ghAccount, installations, vercelReconnectRequired] =
    await Promise.all([
      userExists(session.user.id),
      getGitHubAccount(session.user.id),
      getInstallationsByUserId(session.user.id),
      vercelReconnectPromise,
    ]);

  // The session cookie (JWE) is self-contained and can outlive the user record.
  // If the user no longer exists, clear the stale cookie.
  if (!exists) {
    const store = await cookies();
    store.delete(SESSION_COOKIE_NAME);
    return Response.json(UNAUTHENTICATED);
  }

  const hasGitHubAccount = ghAccount !== null;
  const hasGitHubInstallations = installations.length > 0;
  const hasGitHub = hasGitHubAccount || hasGitHubInstallations;

  const data: SessionUserInfo = {
    user: session.user,
    authProvider: session.authProvider,
    hasGitHub,
    hasGitHubAccount,
    hasGitHubInstallations,
    vercelReconnectRequired,
  };

  return Response.json(data);
}
