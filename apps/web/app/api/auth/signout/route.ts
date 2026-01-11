import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getServerSession } from "@/lib/session/get-server-session";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { SESSION_COOKIE_NAME } from "@/lib/session/constants";

export async function POST(req: NextRequest): Promise<Response> {
  const session = await getServerSession();

  if (session?.authProvider === "github") {
    try {
      const token = await getUserGitHubToken();
      if (token) {
        await fetch(
          `https://api.github.com/applications/${process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID}/token`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Basic ${Buffer.from(`${process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`).toString("base64")}`,
              Accept: "application/vnd.github.v3+json",
            },
            body: JSON.stringify({ access_token: token }),
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
