import type { NextRequest } from "next/server";
import { getGitHubAccount } from "@/lib/db/accounts";
import { getInstallationsByUserId } from "@/lib/db/installations";
import { getSessionFromReq } from "@/lib/session/server";
import type { SessionUserInfo } from "@/lib/session/types";

export async function GET(req: NextRequest) {
  const session = await getSessionFromReq(req);

  let hasGitHub = false;
  let hasGitHubAccount = false;
  let hasGitHubInstallations = false;
  if (session?.user?.id) {
    const [ghAccount, installations] = await Promise.all([
      getGitHubAccount(session.user.id),
      getInstallationsByUserId(session.user.id),
    ]);
    hasGitHubAccount = ghAccount !== null;
    hasGitHubInstallations = installations.length > 0;
    hasGitHub = hasGitHubAccount || hasGitHubInstallations;
  }

  const data: SessionUserInfo = session
    ? {
        user: session.user,
        authProvider: session.authProvider,
        hasGitHub,
        hasGitHubAccount,
        hasGitHubInstallations,
      }
    : { user: undefined };

  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}
