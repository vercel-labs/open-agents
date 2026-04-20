"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Github, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";
import { authClient } from "@/lib/auth/client";

type StepId = 1 | 2;

function OpenAgentsLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-label="Open Agents"
    >
      <path
        d="M4 17L10 11L4 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 19H20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function sanitizeRedirectPath(rawPath: string | null): string {
  if (!rawPath) {
    return "/sessions";
  }

  if (!rawPath.startsWith("/") || rawPath.startsWith("//")) {
    return "/sessions";
  }

  return rawPath;
}

export function GetStartedFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    session,
    loading: sessionLoading,
    hasGitHubAccount,
    hasGitHubInstallations,
  } = useSession();
  const isGitHubReconnect = searchParams.get("step") === "github";
  const redirectPath = sanitizeRedirectPath(searchParams.get("next"));
  const [activeStep, setActiveStep] = useState<StepId>(
    isGitHubReconnect ? 2 : 1,
  );
  const [completedSteps, setCompletedSteps] = useState<Set<StepId>>(
    () => new Set(isGitHubReconnect ? [1] : []),
  );

  const markComplete = useCallback((step: StepId) => {
    setCompletedSteps((prev) => new Set([...prev, step]));
    if (step < 2) {
      setActiveStep((step + 1) as StepId);
    }
  }, []);

  const canOpenStep = (step: StepId): boolean => {
    if (step === 1) return true;
    for (let i = 1; i < step; i++) {
      if (!completedSteps.has(i as StepId)) return false;
    }
    return true;
  };

  const handleStepClick = (step: StepId) => {
    if (canOpenStep(step)) {
      setActiveStep(step);
    }
  };

  const steps: { id: StepId; title: string }[] = [
    { id: 1, title: "Vercel Account" },
    { id: 2, title: "Connect GitHub" },
  ];

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* left panel */}
      <div className="flex shrink-0 flex-col justify-between bg-black px-6 py-6 md:w-1/2 md:px-12 md:py-10">
        <div className="flex items-center gap-3">
          <OpenAgentsLogo className="size-7 text-white/50" />
          <span className="text-lg font-semibold tracking-tight text-white/50">
            Open Agents
          </span>
        </div>
        <p className="hidden max-w-sm text-sm leading-relaxed text-zinc-600 md:block">
          Spawn coding agents that run infinitely in the cloud. Powered by AI
          SDK, Gateway, Sandbox, and Workflow SDK.
        </p>
      </div>

      {/* right panel */}
      <div className="flex flex-1 flex-col bg-zinc-950 px-6 py-8 md:px-10 md:py-10">
        <div className="flex w-full flex-1 flex-col">
          <h1 className="mb-6 text-2xl font-semibold tracking-tight text-white">
            Get Started
          </h1>

          <div className="flex-1">
            {steps.map((step) => {
              const isActive = activeStep === step.id;
              const isCompleted = completedSteps.has(step.id);
              const isLocked = !canOpenStep(step.id);

              return (
                <div key={step.id} className="border-b border-white/10">
                  <button
                    type="button"
                    onClick={() => handleStepClick(step.id)}
                    disabled={isLocked}
                    className={`flex w-full items-center gap-3 py-4 text-left transition-colors duration-200 disabled:cursor-not-allowed ${
                      isLocked
                        ? "text-zinc-600"
                        : isCompleted
                          ? "text-zinc-400"
                          : isActive
                            ? "text-white"
                            : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <span
                      className={`text-sm tabular-nums ${
                        isLocked
                          ? "text-zinc-700"
                          : isActive
                            ? "text-white"
                            : "text-zinc-500"
                      }`}
                    >
                      {step.id}.
                    </span>
                    <span
                      className={`text-sm font-medium ${isActive ? "text-white" : ""}`}
                    >
                      {step.title}
                    </span>
                    {isCompleted && (
                      <Check
                        className="ml-auto size-4 text-white"
                        strokeWidth={2.5}
                      />
                    )}
                  </button>

                  <div
                    className={`grid transition-all duration-300 ease-in-out ${
                      isActive
                        ? "grid-rows-[1fr] opacity-100"
                        : "grid-rows-[0fr] opacity-0"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="pb-5">
                        {step.id === 1 && (
                          <VercelAccountStep
                            session={session}
                            loading={sessionLoading}
                            onComplete={() => markComplete(1)}
                          />
                        )}
                        {step.id === 2 && (
                          <GitHubConnectStep
                            session={session}
                            loading={sessionLoading}
                            hasGitHubAccount={hasGitHubAccount}
                            hasGitHubInstallations={hasGitHubInstallations}
                            forceReconnect={isGitHubReconnect}
                            redirectPath={redirectPath}
                            onComplete={() => {
                              markComplete(2);
                              router.push(redirectPath);
                            }}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// step 1: vercel account (display only)

function VercelAccountStep({
  session,
  loading,
  onComplete,
}: {
  session: ReturnType<typeof useSession>["session"];
  loading: boolean;
  onComplete: () => void;
}) {
  if (loading) {
    return <Skeleton className="h-10 w-full rounded bg-white/5" />;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        Signed in via Vercel. This account is used for authentication.
      </p>
      <div className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2.5">
        <div className="flex items-center gap-3">
          {session?.user?.avatar ? (
            <Image
              src={session.user.avatar}
              alt=""
              width={32}
              height={32}
              className="size-8 rounded-full bg-zinc-800"
            />
          ) : (
            <div className="size-8 rounded-full bg-zinc-800" />
          )}
          <div>
            <p className="text-sm font-medium text-zinc-200">
              {session?.user?.name ?? session?.user?.username ?? "Vercel"}
            </p>
            {session?.user?.email && (
              <p className="text-xs text-zinc-600">{session.user.email}</p>
            )}
          </div>
        </div>
      </div>
      <Button
        size="sm"
        onClick={onComplete}
        className="gap-2 bg-white text-black hover:bg-zinc-200"
      >
        Continue
      </Button>
    </div>
  );
}

// step 2: github connect

function GitHubConnectStep({
  session,
  loading,
  hasGitHubAccount,
  hasGitHubInstallations,
  forceReconnect,
  redirectPath,
  onComplete,
}: {
  session: ReturnType<typeof useSession>["session"];
  loading: boolean;
  hasGitHubAccount: boolean;
  hasGitHubInstallations: boolean;
  forceReconnect: boolean;
  redirectPath: string;
  onComplete: () => void;
}) {
  const [isLinking, setIsLinking] = useState(false);
  const isConnected =
    !forceReconnect && hasGitHubAccount && hasGitHubInstallations;
  const shouldShowInstallStep =
    !forceReconnect && hasGitHubAccount && !hasGitHubInstallations;
  const githubInstallHref = `/api/github/app/install?next=${encodeURIComponent(redirectPath)}`;
  const githubPostLinkCallback = `/api/github/post-link?next=${encodeURIComponent(redirectPath)}`;

  if (loading) {
    return <Skeleton className="h-10 w-full rounded bg-white/5" />;
  }

  if (isConnected) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2.5">
          <div className="flex items-center gap-3">
            {session?.user?.avatar ? (
              <Image
                src={session.user.avatar}
                alt=""
                width={32}
                height={32}
                className="size-8 rounded-full bg-zinc-800"
              />
            ) : (
              <div className="flex size-8 items-center justify-center rounded-full bg-zinc-800">
                <Github className="size-4 text-zinc-400" />
              </div>
            )}
            <div>
              <p className="text-sm font-medium text-zinc-200">
                GitHub connected
              </p>
              {session?.user?.username && (
                <p className="text-xs text-zinc-600">
                  @{session.user.username}
                </p>
              )}
            </div>
          </div>
          <Check className="size-4 text-emerald-400" strokeWidth={2.5} />
        </div>
        <Button
          size="sm"
          onClick={onComplete}
          className="gap-2 bg-white text-black hover:bg-zinc-200"
        >
          Get Started
        </Button>
      </div>
    );
  }

  if (shouldShowInstallStep) {
    // linked but no app installed
    return (
      <div className="space-y-3">
        <p className="text-xs text-zinc-500">
          GitHub account linked. Install the GitHub App to grant repo access.
        </p>
        <Button
          asChild
          variant="outline"
          className="gap-2 border-zinc-700 bg-transparent text-zinc-300 hover:bg-white/5 hover:text-white"
        >
          <Link href={githubInstallHref}>
            <Github className="size-4" />
            Install GitHub App
          </Link>
        </Button>
      </div>
    );
  }

  // not linked
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        {forceReconnect
          ? "Reconnect your GitHub account to restore repository and installation access."
          : "Connect your GitHub account to clone repos, create PRs, and push code."}
      </p>
      <Button
        variant="outline"
        disabled={isLinking}
        onClick={async () => {
          setIsLinking(true);
          await authClient.linkSocial({
            provider: "github",
            callbackURL: githubPostLinkCallback,
          });
        }}
        className="gap-2 border-zinc-700 bg-transparent text-zinc-300 hover:bg-white/5 hover:text-white"
      >
        {isLinking ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Github className="size-4" />
        )}
        {forceReconnect ? "Reconnect GitHub" : "Connect GitHub"}
      </Button>
    </div>
  );
}
