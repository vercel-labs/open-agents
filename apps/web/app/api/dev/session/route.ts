import { randomBytes, timingSafeEqual } from "node:crypto";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { authSessions, users } from "@/lib/db/schema";

const MIN_SECRET_HEX_LENGTH = 64;

// Fixed sentinel ID for the test bot user. Cannot collide with Better Auth's
// nanoid-generated IDs (default size 21) because it is shorter and uses a
// distinctive double-underscore pattern.
const TEST_BOT_USER_ID = "__test_bot__";
const TEST_BOT_USERNAME = "test-bot";
// A vercel.com email exempts the bot from the managed-template-trial gate
// (`hasAllowedManagedTemplateEmail`) so it can create multiple sessions and
// send unlimited messages while testing.
const TEST_BOT_EMAIL = "test-bot@vercel.com";

function isProductionDeployment(): boolean {
  if (process.env.VERCEL_ENV === "production") return true;
  if (
    process.env.NODE_ENV === "production" &&
    process.env.VERCEL_ENV === undefined &&
    process.env.OPEN_AGENTS_ALLOW_TEST_AUTH_DO_NOT_SET_IN_PRODUCTION !== "true"
  ) {
    return true;
  }
  return false;
}

function isTestAuthEnabled(): boolean {
  return (
    process.env.OPEN_AGENTS_ALLOW_TEST_AUTH_DO_NOT_SET_IN_PRODUCTION === "true"
  );
}

function getTestAuthSecret(): string | null {
  const secret =
    process.env.OPEN_AGENTS_TEST_AUTH_SECRET_DO_NOT_SET_IN_PRODUCTION;
  if (!secret || secret.length < MIN_SECRET_HEX_LENGTH) {
    return null;
  }
  return secret;
}

function constantTimeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function buildSetCookieHeader(
  name: string,
  value: string,
  attributes: { secure?: boolean; path?: string; sameSite?: string },
  maxAgeSeconds: number,
): string {
  const sameSiteRaw = attributes.sameSite ?? "Lax";
  const sameSite =
    sameSiteRaw.charAt(0).toUpperCase() + sameSiteRaw.slice(1).toLowerCase();
  const parts = [
    `${name}=${value}`,
    `Path=${attributes.path ?? "/"}`,
    "HttpOnly",
    `SameSite=${sameSite}`,
    ...(attributes.secure ? ["Secure"] : []),
    `Max-Age=${maxAgeSeconds}`,
  ];
  return parts.join("; ");
}

async function ensureTestBotUser(): Promise<{ id: string; username: string }> {
  const existing = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, TEST_BOT_USER_ID))
    .limit(1);

  const row = existing[0];
  if (row) {
    // Backfill the bot's email if it was created before this field was set.
    if (row.email !== TEST_BOT_EMAIL) {
      await db
        .update(users)
        .set({ email: TEST_BOT_EMAIL, emailVerified: true })
        .where(eq(users.id, TEST_BOT_USER_ID));
    }
    return { id: row.id, username: row.username };
  }

  await db
    .insert(users)
    .values({
      id: TEST_BOT_USER_ID,
      username: TEST_BOT_USERNAME,
      email: TEST_BOT_EMAIL,
      emailVerified: true,
      name: "Test Bot",
      isAdmin: false,
    })
    .onConflictDoNothing();

  return { id: TEST_BOT_USER_ID, username: TEST_BOT_USERNAME };
}

export async function POST(req: NextRequest): Promise<Response> {
  if (isProductionDeployment()) {
    return new Response(null, { status: 404 });
  }

  if (!isTestAuthEnabled()) {
    return new Response(null, { status: 404 });
  }

  const expectedSecret = getTestAuthSecret();
  if (!expectedSecret) {
    return new Response(null, { status: 404 });
  }

  const providedSecret = req.headers.get("x-test-auth") ?? "";
  if (!constantTimeStringEqual(providedSecret, expectedSecret)) {
    return jsonError(401, "unauthorized");
  }

  const user = await ensureTestBotUser();
  const ctx = await auth.$context;
  const sessionMaxAgeSeconds = ctx.sessionConfig.expiresIn;

  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionMaxAgeSeconds * 1000);

  await db.delete(authSessions).where(eq(authSessions.userId, user.id));

  await db.insert(authSessions).values({
    id: nanoid(),
    token,
    userId: user.id,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });

  const cookieName = ctx.authCookies.sessionToken.name;
  const cookieAttrs = ctx.authCookies.sessionToken.attributes;
  const signature = await makeSignature(token, ctx.secret);
  const rawSigned = `${token}.${signature}`;
  const encodedValue = encodeURIComponent(rawSigned);

  console.log(
    `[dev/session] minted session for bot userId=${user.id} expiresAt=${expiresAt.toISOString()}`,
  );

  const setCookie = buildSetCookieHeader(
    cookieName,
    encodedValue,
    cookieAttrs,
    sessionMaxAgeSeconds,
  );

  return new Response(
    JSON.stringify({
      cookie: { name: cookieName, value: encodedValue },
      header: `${cookieName}=${encodedValue}`,
      token,
      expiresAt: expiresAt.toISOString(),
      expiresIn: sessionMaxAgeSeconds,
      user: { id: user.id, username: user.username },
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": setCookie,
      },
    },
  );
}
