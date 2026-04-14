import { cookies } from "next/headers";
import { type NextRequest } from "next/server";
import { encrypt } from "@/lib/crypto";
import { upsertUser } from "@/lib/db/users";
import { encryptJWE } from "@/lib/jwe/encrypt";
import { SESSION_COOKIE_NAME } from "@/lib/session/constants";
import { workos } from "@/lib/workos/client";

function clearWorkOSAuthCookies(store: Awaited<ReturnType<typeof cookies>>) {
  store.delete("workos_auth_state");
  store.delete("workos_auth_redirect_to");
}

export async function GET(req: NextRequest): Promise<Response> {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieStore = await cookies();

  const storedState = cookieStore.get("workos_auth_state")?.value;
  const rawRedirectTo =
    cookieStore.get("workos_auth_redirect_to")?.value ?? "/";

  const storedRedirectTo =
    rawRedirectTo.startsWith("/") && !rawRedirectTo.startsWith("//")
      ? rawRedirectTo
      : "/";

  if (!code || !state || storedState !== state) {
    return new Response("Invalid OAuth state", { status: 400 });
  }

  const clientId = process.env.WORKOS_CLIENT_ID;

  if (!clientId) {
    return new Response("WorkOS not configured", { status: 500 });
  }

  try {
    const { user, accessToken, refreshToken } =
      await workos.userManagement.authenticateWithCode({
        code,
        clientId,
      });

    const username = user.email;
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ");

    const userId = await upsertUser({
      provider: "workos",
      externalId: user.id,
      accessToken: encrypt(accessToken),
      refreshToken: refreshToken ? encrypt(refreshToken) : undefined,
      username,
      email: user.email,
      name: name || undefined,
      avatarUrl: user.profilePictureUrl ?? undefined,
    });

    const session = {
      created: Date.now(),
      authProvider: "workos" as const,
      user: {
        id: userId,
        username,
        email: user.email,
        name: name || username,
        avatar: user.profilePictureUrl ?? "",
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

    clearWorkOSAuthCookies(cookieStore);

    return response;
  } catch (error) {
    console.error("WorkOS callback error:", error);
    return new Response("Authentication failed", { status: 500 });
  }
}
