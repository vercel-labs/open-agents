"use server";

import { cookies } from "next/headers";
import { deleteInstallationsByUserId } from "@/lib/db/installations";
import {
  deleteGitHubAccountLink,
  getUserGitHubToken,
  hasGitHubAccount,
} from "@/lib/github/token";
import { getServerSession } from "@/lib/session/get-server-session";

export async function unlinkGitHub(): Promise<{
  success: boolean;
  error?: string;
}> {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const linked = await hasGitHubAccount(session.user.id);
    if (!linked) {
      await deleteInstallationsByUserId(session.user.id);
      return { success: true };
    }

    // revoke the github token before unlinking
    try {
      const token = await getUserGitHubToken(session.user.id);
      if (token) {
        const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
        const clientSecret = process.env.GITHUB_CLIENT_SECRET;
        if (clientId && clientSecret) {
          await fetch(`https://api.github.com/applications/${clientId}/token`, {
            method: "DELETE",
            headers: {
              Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
              Accept: "application/vnd.github.v3+json",
            },
            body: JSON.stringify({ access_token: token }),
          });
        }
      }
    } catch (error) {
      console.error("Failed to revoke GitHub token:", error);
    }

    await Promise.all([
      deleteGitHubAccountLink(session.user.id),
      deleteInstallationsByUserId(session.user.id),
    ]);

    const cookieStore = await cookies();
    cookieStore.set("github_reconnect", "1", {
      path: "/",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 60 * 60,
      sameSite: "lax",
    });

    return { success: true };
  } catch (error) {
    console.error("Failed to unlink GitHub:", error);
    return { success: false, error: "Failed to unlink GitHub account" };
  }
}
