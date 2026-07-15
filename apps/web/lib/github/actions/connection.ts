"use server";

import { cookies } from "next/headers";
import { deleteInstallationsByUserId } from "@/lib/db/installations";
import { deleteGitHubAccountLink, hasGitHubAccount } from "@/lib/github/users";
import { revokeUserGitHubGrant } from "@/lib/github/token";
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

    // revoke the Vercel Connect grant before unlinking
    await revokeUserGitHubGrant(session.user.id);

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
