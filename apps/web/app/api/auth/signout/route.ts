import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getServerSession } from "@/lib/session/get-server-session";
import { SESSION_COOKIE_NAME } from "@/lib/session/constants";
import { revokeVercelToken } from "@/lib/vercel/oauth";
import { getUserVercelToken } from "@/lib/vercel/token";
import { getGitHubAccount } from "@/lib/db/accounts";
import { decrypt } from "@/lib/crypto";

export async function POST(req: NextRequest): Promise<Response> {
  const session = await getServerSession();

  if (session?.user?.id) {
    // Revoke Vercel token if signed in with Vercel
    if (session.authProvider === "vercel") {
      try {
        const clientId = process.env.NEXT_PUBLIC_VERCEL_APP_CLIENT_ID;
        const clientSecret = process.env.VERCEL_APP_CLIENT_SECRET;
        if (clientId && clientSecret) {
          const token = await getUserVercelToken(session.user.id);
          if (token) {
            await revokeVercelToken({ token, clientId, clientSecret });
          }
        }
      } catch (error) {
        console.error("Failed to revoke Vercel token:", error);
      }
    }

    // Revoke linked GitHub token if present
    try {
      const ghAccount = await getGitHubAccount(session.user.id);
      if (ghAccount) {
        const ghToken = decrypt(ghAccount.accessToken);
        await fetch(
          `https://api.github.com/applications/${process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID}/token`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Basic ${Buffer.from(`${process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`).toString("base64")}`,
              Accept: "application/vnd.github.v3+json",
            },
            body: JSON.stringify({ access_token: ghToken }),
          },
        );
      }
    } catch (error) {
      console.error("Failed to revoke GitHub token:", error);
    }
  }

  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);

  return Response.redirect(new URL("/", req.url));
}
