import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getLastRepoByUserId } from "@/lib/db/last-repo";
import { SESSION_COOKIE_NAME } from "@/lib/session/constants";
import { getServerSession } from "@/lib/session/get-server-session";
import { HomePage } from "./home-page";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Review recent runs and start new sessions in Open Harness.",
};

export default async function Home() {
  const store = await cookies();
  const hasSessionCookie = Boolean(store.get(SESSION_COOKIE_NAME)?.value);

  let lastRepo: { owner: string; repo: string } | null = null;
  if (hasSessionCookie) {
    const session = await getServerSession();
    if (session?.user?.id) {
      lastRepo = await getLastRepoByUserId(session.user.id);
    }
  }

  return <HomePage hasSessionCookie={hasSessionCookie} lastRepo={lastRepo} />;
}
