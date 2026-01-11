import type { NextRequest } from "next/server";
import type { Session } from "./types";
import { SESSION_COOKIE_NAME } from "./constants";
import { decryptJWE } from "@/lib/jwe/decrypt";

export async function getSessionFromCookie(
  cookieValue?: string,
): Promise<Session | undefined> {
  if (cookieValue) {
    const decrypted = await decryptJWE<Session>(cookieValue);
    if (decrypted) {
      return {
        created: decrypted.created,
        authProvider: decrypted.authProvider,
        user: decrypted.user,
      };
    }
  }
}

export async function getSessionFromReq(
  req: NextRequest,
): Promise<Session | undefined> {
  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  return getSessionFromCookie(cookieValue);
}
