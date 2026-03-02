import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLastRepoByUserId } from "@/lib/db/last-repo";
import { getServerSession } from "@/lib/session/get-server-session";
import { SessionsIndexShell } from "./sessions-index-shell";

export const metadata: Metadata = {
  title: "Sessions",
  description: "View and manage your sessions.",
};

export default async function SessionsPage() {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/");
  }

  const lastRepo = await getLastRepoByUserId(session.user.id);

  return <SessionsIndexShell lastRepo={lastRepo} />;
}
