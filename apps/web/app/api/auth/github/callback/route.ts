import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { encrypt } from "@/lib/crypto";
import { encryptJWE } from "@/lib/jwe/encrypt";
import { upsertUser } from "@/lib/db/users";
import { SESSION_COOKIE_NAME } from "@/lib/session/constants";

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

export async function GET(req: NextRequest): Promise<Response> {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieStore = await cookies();

  const storedState = cookieStore.get("github_auth_state")?.value;
  const storedRedirectTo =
    cookieStore.get("github_auth_redirect_to")?.value ?? "/";

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
          code: code,
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
        `Failed to authenticate: ${tokenData.error_description || "Unknown error"}`,
        { status: 400 },
      );
    }

    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    const githubUser = (await userResponse.json()) as GitHubUser;

    let email = githubUser.email;
    if (!email) {
      const emailsResponse = await fetch("https://api.github.com/user/emails", {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });
      if (emailsResponse.ok) {
        const emails = (await emailsResponse.json()) as GitHubEmail[];
        const primaryEmail = emails.find((e) => e.primary && e.verified);
        email = primaryEmail?.email || emails[0]?.email || null;
      }
    }

    const userId = await upsertUser({
      provider: "github",
      externalId: `${githubUser.id}`,
      accessToken: encrypt(tokenData.access_token),
      scope: tokenData.scope,
      username: githubUser.login,
      email: email || undefined,
      name: githubUser.name || githubUser.login,
      avatarUrl: githubUser.avatar_url,
    });

    const session = {
      created: Date.now(),
      authProvider: "github" as const,
      user: {
        id: userId,
        username: githubUser.login,
        email: email || undefined,
        name: githubUser.name || githubUser.login,
        avatar: githubUser.avatar_url,
      },
    };

    const sessionToken = await encryptJWE(session, "1y");
    const expires = new Date(
      Date.now() + 365 * 24 * 60 * 60 * 1000,
    ).toUTCString();

    const response = new Response(null, {
      status: 302,
      headers: {
        Location: storedRedirectTo,
      },
    });

    response.headers.append(
      "Set-Cookie",
      `${SESSION_COOKIE_NAME}=${sessionToken}; Path=/; Max-Age=${365 * 24 * 60 * 60}; Expires=${expires}; HttpOnly; ${process.env.NODE_ENV === "production" ? "Secure; " : ""}SameSite=Lax`,
    );

    cookieStore.delete("github_auth_state");
    cookieStore.delete("github_auth_redirect_to");

    return response;
  } catch (error) {
    console.error("OAuth callback error:", error);
    return new Response("Authentication failed", { status: 500 });
  }
}
