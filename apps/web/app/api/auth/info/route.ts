import type { NextRequest } from "next/server";
import type { SessionUserInfo } from "@/lib/session/types";
import { getSessionFromReq } from "@/lib/session/server";
import { getGitHubAccount } from "@/lib/db/accounts";

export async function GET(req: NextRequest) {
  const session = await getSessionFromReq(req);

  let hasGitHub = false;
  if (session?.user?.id) {
    const ghAccount = await getGitHubAccount(session.user.id);
    hasGitHub = ghAccount !== null;
  }

  const data: SessionUserInfo = session
    ? { user: session.user, authProvider: session.authProvider, hasGitHub }
    : { user: undefined };

  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}
