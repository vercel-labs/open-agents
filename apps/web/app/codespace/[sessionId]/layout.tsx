import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSessionByIdCached } from "@/lib/db/sessions-cache";
import { getServerSession } from "@/lib/session/get-server-session";
import { CodespaceProvider } from "./codespace-context";

interface CodespaceLayoutProps {
  params: Promise<{ sessionId: string }>;
  children: ReactNode;
}

export default async function CodespaceLayout({
  params,
  children,
}: CodespaceLayoutProps) {
  const { sessionId } = await params;

  const [session, sessionRecord] = await Promise.all([
    getServerSession(),
    getSessionByIdCached(sessionId),
  ]);

  if (!session?.user) {
    redirect("/");
  }

  if (!sessionRecord) {
    notFound();
  }

  if (sessionRecord.userId !== session.user.id) {
    redirect("/");
  }

  return (
    <CodespaceProvider sessionTitle={sessionRecord.title}>
      {children}
    </CodespaceProvider>
  );
}
