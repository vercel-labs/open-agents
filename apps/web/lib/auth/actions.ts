"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { getServerSession } from "@/lib/session/get-server-session";
import { getUserVercelToken } from "@/lib/vercel/token";

const VERCEL_REVOKE_URL = "https://api.vercel.com/login/oauth/token/revoke";

async function revokeVercelToken(params: {
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

async function getRevocableVercelToken(userId: string): Promise<string | null> {
  try {
    return await getUserVercelToken(userId);
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  const session = await getServerSession();

  if (session?.user?.id) {
    try {
      const clientId = process.env.NEXT_PUBLIC_VERCEL_APP_CLIENT_ID;
      const clientSecret = process.env.VERCEL_APP_CLIENT_SECRET;
      if (clientId && clientSecret) {
        const token = await getRevocableVercelToken(session.user.id);
        if (token) {
          await revokeVercelToken({ token, clientId, clientSecret });
        }
      }
    } catch (error) {
      console.error(
        "Failed to revoke Vercel token:",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  await auth.api.signOut({ headers: await headers() });

  redirect("/");
}
