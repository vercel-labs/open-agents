"use client";

import { History } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SignedOutHero } from "@/components/auth/signed-out-hero";
import { HomeSkeleton } from "@/components/home-skeleton";
import type { SandboxType } from "@/components/sandbox-selector-compact";
import { SessionDrawer } from "@/components/session-drawer";
import { SessionStarter } from "@/components/session-starter";
import { UserAvatarDropdown } from "@/components/user-avatar-dropdown";
import { useCliTokens } from "@/hooks/use-cli-tokens";
import { useSession } from "@/hooks/use-session";
import { useSessions } from "@/hooks/use-sessions";

interface HomePageProps {
  hasSessionCookie: boolean;
}

export function HomePage({ hasSessionCookie }: HomePageProps) {
  const router = useRouter();
  const { loading: sessionLoading, isAuthenticated } = useSession();
  const { sessions, loading, createSession } = useSessions({
    enabled: isAuthenticated,
  });

  const activeSessionCount = sessions.filter(
    (s) => s.status !== "archived",
  ).length;
  const [isCreating, setIsCreating] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleCreateSession = async (input: {
    repoOwner?: string;
    repoName?: string;
    branch?: string;
    cloneUrl?: string;
    isNewBranch: boolean;
    sandboxType: SandboxType;
  }) => {
    setIsCreating(true);
    try {
      const { session: createdSession, chat } = await createSession({
        repoOwner: input.repoOwner,
        repoName: input.repoName,
        branch: input.branch,
        cloneUrl: input.cloneUrl,
        isNewBranch: input.isNewBranch,
        sandboxType: input.sandboxType,
      });
      router.push(`/sessions/${createdSession.id}/chats/${chat.id}`);
    } catch (error) {
      console.error("Failed to create session:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleSessionClick = (sessionId: string) => {
    router.push(`/sessions/${sessionId}`);
  };

  if (sessionLoading && hasSessionCookie) {
    return <HomeSkeleton />;
  }

  if (!isAuthenticated) {
    return <SignedOutHero />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-4 sm:grid sm:grid-cols-[1fr_auto_1fr]">
        <div className="flex items-center gap-2 sm:justify-self-start">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-4 w-4"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
          </div>
          <span className="text-lg font-semibold">Open Harness</span>
        </div>
        <div className="hidden sm:flex sm:justify-self-center">
          <CliConnectBanner />
        </div>
        <div className="flex items-center gap-2 sm:justify-self-end">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <History className="h-4 w-4" />
            <span>Sessions</span>
            {loading ? (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-transparent">
                0
              </span>
            ) : activeSessionCount > 0 ? (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
                {activeSessionCount}
              </span>
            ) : null}
          </button>
          <UserAvatarDropdown />
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center px-6 pt-8 sm:pt-16">
        <h1 className="mb-8 text-3xl font-light text-foreground">
          What should we ship next?
        </h1>

        <SessionStarter onSubmit={handleCreateSession} isLoading={isCreating} />
      </main>

      <SessionDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        sessions={sessions}
        loading={loading}
        onSessionClick={handleSessionClick}
      />
    </div>
  );
}

function CliConnectBanner() {
  const { tokens, loading } = useCliTokens();

  if (loading || tokens.length > 0) {
    return null;
  }

  return (
    <div className="inline-flex items-center gap-3 rounded-full border border-border/60 bg-muted/70 px-4 py-1.5 text-sm text-muted-foreground">
      <span className="text-foreground">
        Run sessions locally with the CLI.
      </span>
      <Link
        href="/settings/tokens"
        className="text-foreground underline decoration-foreground/40 underline-offset-4 transition hover:decoration-foreground"
      >
        Set up CLI
      </Link>
    </div>
  );
}
