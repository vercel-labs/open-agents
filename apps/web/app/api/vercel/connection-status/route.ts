import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/session/get-server-session";
import type { VercelConnectionStatusResponse } from "@/lib/vercel/connection-status";
import { getUserVercelToken } from "@/lib/vercel/token";

const VERCEL_USERINFO_URL = "https://api.vercel.com/login/oauth/userinfo";
const VERCEL_USERINFO_TIMEOUT_MS = 3_000;

export async function GET() {
  const session = await getServerSession();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (session.authProvider !== "vercel") {
    return NextResponse.json({
      status: "connected",
      reason: null,
    } satisfies VercelConnectionStatusResponse);
  }

  const token = await getUserVercelToken(session.user.id);
  if (!token) {
    return NextResponse.json({
      status: "reconnect_required",
      reason: "token_unavailable",
    } satisfies VercelConnectionStatusResponse);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    VERCEL_USERINFO_TIMEOUT_MS,
  );

  try {
    const response = await fetch(VERCEL_USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (response.ok) {
      return NextResponse.json({
        status: "connected",
        reason: null,
      } satisfies VercelConnectionStatusResponse);
    }

    if (
      response.status === 400 ||
      response.status === 401 ||
      response.status === 403
    ) {
      return NextResponse.json({
        status: "reconnect_required",
        reason: "userinfo_auth_failed",
      } satisfies VercelConnectionStatusResponse);
    }

    console.error(
      `Failed to validate Vercel connection status: ${response.status} ${response.statusText}`,
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error("Timed out validating Vercel connection status");
    } else {
      console.error("Failed to validate Vercel connection status:", error);
    }
  } finally {
    clearTimeout(timeoutId);
  }

  return NextResponse.json({
    status: "connected",
    reason: null,
  } satisfies VercelConnectionStatusResponse);
}
