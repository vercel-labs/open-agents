import { decrypt } from "@/lib/crypto";
import { deleteGitHubAccount, getGitHubAccount } from "@/lib/db/accounts";
import { deleteInstallationsByUserId } from "@/lib/db/installations";
import { getServerSession } from "@/lib/session/get-server-session";

export async function POST(): Promise<Response> {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const [ghAccount, installationsDeleted] = await Promise.all([
      getGitHubAccount(session.user.id),
      deleteInstallationsByUserId(session.user.id),
    ]);

    if (!ghAccount && !installationsDeleted) {
      return Response.json(
        { error: "No GitHub connection found" },
        { status: 404 },
      );
    }

    if (ghAccount) {
      // Revoke the GitHub token
      try {
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
      } catch (error) {
        console.error("Failed to revoke GitHub token:", error);
      }

      await deleteGitHubAccount(session.user.id);
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error("Failed to unlink GitHub:", error);
    return Response.json(
      { error: "Failed to unlink GitHub account" },
      { status: 500 },
    );
  }
}
