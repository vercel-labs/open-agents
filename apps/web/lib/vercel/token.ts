import "server-only";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { decrypt, encrypt } from "@/lib/crypto";
import { refreshVercelToken } from "./oauth";

/**
 * Get a valid Vercel access token for the given user.
 * If the token is expired and a refresh token exists, refreshes inline and updates the DB.
 */
export async function getUserVercelToken(
  userId: string,
): Promise<string | null> {
  try {
    const result = await db
      .select({
        accessToken: users.accessToken,
        refreshToken: users.refreshToken,
        tokenExpiresAt: users.tokenExpiresAt,
      })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.provider, "vercel")))
      .limit(1);

    const row = result[0];
    if (!row?.accessToken) return null;

    const now = new Date();
    const isExpired =
      row.tokenExpiresAt && row.tokenExpiresAt.getTime() < now.getTime();

    if (!isExpired) {
      return decrypt(row.accessToken);
    }

    // Token is expired — try refresh
    if (!row.refreshToken) return null;

    const clientId = process.env.NEXT_PUBLIC_VERCEL_APP_CLIENT_ID;
    const clientSecret = process.env.VERCEL_APP_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    const decryptedRefresh = decrypt(row.refreshToken);
    const tokens = await refreshVercelToken({
      refreshToken: decryptedRefresh,
      clientId,
      clientSecret,
    });

    const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await db
      .update(users)
      .set({
        accessToken: encrypt(tokens.access_token),
        refreshToken: tokens.refresh_token
          ? encrypt(tokens.refresh_token)
          : row.refreshToken,
        tokenExpiresAt: newExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return tokens.access_token;
  } catch (error) {
    console.error("Error fetching Vercel token:", error);
    return null;
  }
}
