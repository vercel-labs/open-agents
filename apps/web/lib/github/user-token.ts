import "server-only";
import { db } from "@/lib/db/client";
import { users, accounts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getServerSession } from "@/lib/session/get-server-session";
import { decrypt } from "@/lib/crypto";

export async function getUserGitHubToken(): Promise<string | null> {
  const session = await getServerSession();
  if (!session?.user?.id) return null;

  try {
    const account = await db
      .select({ accessToken: accounts.accessToken })
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, session.user.id),
          eq(accounts.provider, "github"),
        ),
      )
      .limit(1);

    if (account[0]?.accessToken) {
      return decrypt(account[0].accessToken);
    }

    const user = await db
      .select({ accessToken: users.accessToken })
      .from(users)
      .where(and(eq(users.id, session.user.id), eq(users.provider, "github")))
      .limit(1);

    if (user[0]?.accessToken) {
      return decrypt(user[0].accessToken);
    }

    return null;
  } catch (error) {
    console.error("Error fetching GitHub token:", error);
    return null;
  }
}
