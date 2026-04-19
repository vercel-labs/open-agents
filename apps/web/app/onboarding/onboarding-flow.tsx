"use client";

import { useCallback, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Check, Github, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { ModelCombobox } from "@/components/model-combobox";
import { useModelOptions } from "@/hooks/use-model-options";
import { useSession } from "@/hooks/use-session";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { getDefaultModelOptionId } from "@/lib/model-options";
import { fetcher } from "@/lib/swr";

// ─── Types ───────────────────────────────────────────────────────────────────

interface VercelTeam {
  id: string;
  slug: string;
  name: string;
  avatar: string | null;
  membership: { role: string };
}

interface TeamsResponse {
  teams: VercelTeam[];
}

type StepId = 1 | 2 | 3;

// ─── Logo (matches OG image) ────────────────────────────────────────────────

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

// ─── Main Component ─────────────────────────────────────────────────────────

export function OnboardingFlow() {
  const router = useRouter();
  const [activeStep, setActiveStep] = useState<StepId>(1);
  const [completedSteps, setCompletedSteps] = useState<Set<StepId>>(new Set());
  const [isCompleting, setIsCompleting] = useState(false);

  const markComplete = useCallback((step: StepId) => {
    setCompletedSteps((prev) => new Set([...prev, step]));
    if (step < 3) {
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

  const handleGetStarted = () => {
    setIsCompleting(true);
    router.push("/");
  };

  const steps: { id: StepId; title: string }[] = [
    { id: 1, title: "Select Vercel Team" },
    { id: 2, title: "Connect GitHub" },
    { id: 3, title: "Model Preferences" },
  ];

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* ── Left panel: branding ── */}
      <div className="flex shrink-0 flex-col justify-between bg-black px-6 py-6 md:w-1/2 md:px-12 md:py-10">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <OpenAgentsLogo className="size-7 text-white/50" />
          <span className="text-lg font-semibold tracking-tight text-white/50">
            Open Agents
          </span>
        </div>

        {/* Tagline — hidden on mobile, bottom-left */}
        <p className="hidden max-w-sm text-sm leading-relaxed text-zinc-600 md:block">
          Spawn coding agents that run infinitely in the cloud. Powered by AI
          SDK, Gateway, Sandbox, and Workflow SDK.
        </p>
      </div>

      {/* ── Right panel: steps ── */}
      <div className="flex flex-1 flex-col bg-zinc-950 px-6 py-8 md:px-10 md:py-10">
        <div className="flex w-full flex-1 flex-col">
          {/* Section heading */}
          <h1 className="mb-6 text-2xl font-semibold tracking-tight text-white">
            Onboarding
          </h1>

          {/* Steps list */}
          <div className="flex-1">
            {steps.map((step) => {
              const isActive = activeStep === step.id;
              const isCompleted = completedSteps.has(step.id);
              const isLocked = !canOpenStep(step.id);

              return (
                <div key={step.id} className="border-b border-white/10">
                  {/* Step header */}
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

                  {/* Collapsible content */}
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
                          <>
                            <p className="mb-3 text-xs text-zinc-500">
                              All token usage is billed through the selected
                              Vercel team using an AI Gateway API key.
                            </p>
                            <TeamSelector onComplete={() => markComplete(1)} />
                          </>
                        )}
                        {step.id === 2 && (
                          <GitHubConnector onComplete={() => markComplete(2)} />
                        )}
                        {step.id === 3 && (
                          <ModelSelector
                            onGetStarted={handleGetStarted}
                            isCompleting={isCompleting}
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

// ─── Step 1: Team Selector ──────────────────────────────────────────────────

function TeamSelector({ onComplete }: { onComplete: () => void }) {
  const { data, isLoading, error } = useSWR<TeamsResponse>(
    "/api/vercel/teams",
    fetcher,
  );
  const [selectedTeam, setSelectedTeam] = useState<VercelTeam | null>(null);
  const [isExchanging, setIsExchanging] = useState(false);
  const [showPicker, setShowPicker] = useState(true);

  const teams = data?.teams ?? [];

  const handleSelectTeam = async (team: VercelTeam) => {
    setIsExchanging(true);
    try {
      const res = await fetch("/api/vercel/gateway-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id, teamSlug: team.slug }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Failed to exchange API key");
      }
      setSelectedTeam(team);
      setShowPicker(false);
      onComplete();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to connect team",
        { position: "bottom-left" },
      );
    } finally {
      setIsExchanging(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-1">
        <Skeleton className="h-10 w-full rounded bg-white/5" />
        <Skeleton className="h-10 w-full rounded bg-white/5" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-red-400">
        Failed to load teams. Please refresh and try again.
      </p>
    );
  }

  if (teams.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No Vercel teams found. Make sure your account has at least one team.
      </p>
    );
  }

  // Selected state — show team card with Change button
  if (selectedTeam && !showPicker) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2.5">
        <div className="flex items-center gap-3">
          <Image
            src={`https://vercel.com/api/www/avatar?teamId=${selectedTeam.id}&s=64`}
            alt=""
            width={32}
            height={32}
            className="size-8 rounded-full bg-zinc-800"
          />
          <p className="text-sm font-medium text-zinc-200">
            {selectedTeam.name}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowPicker(true)}
          className="text-xs text-zinc-500 underline-offset-2 transition-colors hover:text-zinc-300 hover:underline"
        >
          Change
        </button>
      </div>
    );
  }

  // Picker state — show team list
  return (
    <div className="space-y-2">
      {isExchanging && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="size-3 animate-spin" />
          Connecting…
        </div>
      )}
      <div className="max-h-[200px] overflow-y-auto">
        {teams.map((team) => (
          <button
            key={team.id}
            type="button"
            disabled={isExchanging}
            onClick={() => handleSelectTeam(team)}
            className="flex w-full items-center gap-3 rounded px-1 py-2 text-left transition-colors duration-150 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Image
              src={`https://vercel.com/api/www/avatar?teamId=${team.id}&s=48`}
              alt=""
              width={24}
              height={24}
              className="size-6 rounded-full bg-zinc-800"
            />
            <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
              {team.name}
            </span>
          </button>
        ))}
      </div>
      {selectedTeam && (
        <button
          type="button"
          onClick={() => setShowPicker(false)}
          className="text-xs text-zinc-600 underline-offset-2 hover:text-zinc-400 hover:underline"
        >
          Cancel
        </button>
      )}
    </div>
  );
}

// ─── Step 2: GitHub Connector ───────────────────────────────────────────────

function GitHubConnector({ onComplete }: { onComplete: () => void }) {
  const { session, loading, hasGitHubAccount, hasGitHubInstallations } =
    useSession();
  const [showConnect, setShowConnect] = useState(false);

  const isConnected = hasGitHubAccount && hasGitHubInstallations;

  if (loading) {
    return <Skeleton className="h-10 w-full rounded bg-white/5" />;
  }

  // Connected state — show profile card with Change button
  if (isConnected && !showConnect) {
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
                {session?.user?.name ?? "GitHub"}
              </p>
              {session?.user?.username && (
                <p className="text-xs text-zinc-600">
                  @{session.user.username}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowConnect(true)}
            className="text-xs text-zinc-500 underline-offset-2 transition-colors hover:text-zinc-300 hover:underline"
          >
            Change
          </button>
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

  // Connect / reconnect state
  return (
    <div className="space-y-3">
      <Button
        asChild
        variant="outline"
        className="gap-2 border-zinc-700 bg-transparent text-zinc-300 hover:bg-white/5 hover:text-white"
      >
        <Link href="/api/auth/github/reconnect?next=/onboarding">
          <Github className="size-4" />
          {isConnected ? "Reconnect GitHub" : "Connect GitHub"}
        </Link>
      </Button>
      {isConnected && (
        <button
          type="button"
          onClick={() => setShowConnect(false)}
          className="block text-xs text-zinc-600 underline-offset-2 transition-colors hover:text-zinc-400 hover:underline"
        >
          Cancel
        </button>
      )}
      {!isConnected && (
        <button
          type="button"
          onClick={onComplete}
          className="block text-xs text-zinc-600 underline-offset-2 transition-colors hover:text-zinc-400 hover:underline"
        >
          Skip for now
        </button>
      )}
    </div>
  );
}

// ─── Step 3: Model Selector ─────────────────────────────────────────────────

function ModelSelector({
  onGetStarted,
  isCompleting,
}: {
  onGetStarted: () => void;
  isCompleting: boolean;
}) {
  const { modelOptions, loading: modelsLoading } = useModelOptions();
  const {
    preferences,
    loading: prefsLoading,
    updatePreferences,
  } = useUserPreferences();
  const [isSaving, setIsSaving] = useState(false);

  const defaultId = useMemo(
    () => getDefaultModelOptionId(modelOptions),
    [modelOptions],
  );
  const currentModelId = preferences?.defaultModelId ?? defaultId;

  const items = useMemo(
    () =>
      modelOptions.map((opt) => ({
        id: opt.id,
        label: opt.label,
        description: opt.description,
        isVariant: opt.isVariant,
      })),
    [modelOptions],
  );

  const handleGetStarted = async () => {
    setIsSaving(true);
    try {
      await updatePreferences({ defaultModelId: currentModelId });
      onGetStarted();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save preference",
        { position: "bottom-left" },
      );
      setIsSaving(false);
    }
  };

  if (modelsLoading || prefsLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-full max-w-xs rounded bg-white/5" />
        <Skeleton className="h-9 w-24 rounded bg-white/5" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs text-zinc-500">Default Model</Label>
        <ModelCombobox
          value={currentModelId}
          items={items}
          placeholder="Select a model"
          searchPlaceholder="Search models…"
          emptyText="No models found."
          disabled={isSaving || isCompleting}
          onChange={(id) => {
            updatePreferences({ defaultModelId: id }).catch(() => {});
          }}
        />
      </div>

      <Button
        size="sm"
        disabled={isSaving || isCompleting}
        onClick={handleGetStarted}
        className="gap-2 bg-white text-black hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500"
      >
        {isSaving || isCompleting ? (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            {isCompleting ? "Setting up…" : "Saving…"}
          </>
        ) : (
          "Get Started"
        )}
      </Button>
    </div>
  );
}
