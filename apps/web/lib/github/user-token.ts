import "server-only";
import { getServerSession } from "@/lib/session/get-server-session";
import { getGitHubAccount } from "@/lib/db/accounts";
import { decrypt } from "@/lib/crypto";

export async function getUserGitHubToken(): Promise<string | null> {
  const session = await getServerSession();
  if (!session?.user?.id) return null;

  try {
    const ghAccount = await getGitHubAccount(session.user.id);
    if (ghAccount?.accessToken) {
      return decrypt(ghAccount.accessToken);
    }
    return null;
  } catch (error) {
    console.error("Error fetching GitHub token:", error);
    return null;
  }
}
