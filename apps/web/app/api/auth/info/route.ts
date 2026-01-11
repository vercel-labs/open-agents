import type { NextRequest } from "next/server";
import type { SessionUserInfo } from "@/lib/session/types";
import { getSessionFromReq } from "@/lib/session/server";

export async function GET(req: NextRequest) {
  const session = await getSessionFromReq(req);

  const data: SessionUserInfo = session
    ? { user: session.user, authProvider: session.authProvider }
    : { user: undefined };

  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}
