import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { encrypt } from "@/lib/crypto";
import { getServerSession } from "@/lib/session/get-server-session";
import { upsertGitHubAccount } from "@/lib/db/accounts";

interface GitHubUser {
  id: number;
  login: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return new Response("Not authenticated", { status: 401 });
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieStore = await cookies();

  const storedState = cookieStore.get("github_link_state")?.value;

  if (!code || !state || storedState !== state) {
    return new Response("Invalid OAuth state", { status: 400 });
  }

  const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new Response("GitHub OAuth not configured", { status: 500 });
  }

  try {
    const tokenResponse = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      },
    );

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      scope?: string;
      error_description?: string;
    };

    if (!tokenData.access_token) {
      return new Response(
        `Failed to authenticate: ${tokenData.error_description ?? "Unknown error"}`,
        { status: 400 },
      );
    }

    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!userResponse.ok) {
      return new Response("Failed to fetch GitHub user", { status: 400 });
    }

    const githubUser = (await userResponse.json()) as GitHubUser;

    await upsertGitHubAccount({
      userId: session.user.id,
      externalUserId: `${githubUser.id}`,
      accessToken: encrypt(tokenData.access_token),
      scope: tokenData.scope,
      username: githubUser.login,
    });

    cookieStore.delete("github_link_state");

    return Response.redirect(new URL("/settings/accounts", req.url));
  } catch (error) {
    console.error("GitHub link callback error:", error);
    return new Response("Failed to link GitHub account", { status: 500 });
  }
}
