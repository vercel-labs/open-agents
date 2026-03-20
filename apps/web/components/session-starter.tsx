"use client";

import {
  AlertCircleIcon,
  GitBranch,
  Plus,
  SearchIcon,
  X,
  XCircleIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@/hooks/use-session";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { useVercelRepoProjects } from "@/hooks/use-vercel-repo-projects";
import type { VercelProjectSelection } from "@/lib/vercel/types";
import { cn } from "@/lib/utils";
import { BranchSelectorCompact } from "./branch-selector-compact";
import { RepoSelectorCompact } from "./repo-selector-compact";
import {
  DEFAULT_SANDBOX_TYPE,
  SANDBOX_OPTIONS,
  type SandboxType,
} from "./sandbox-selector-compact";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Switch } from "./ui/switch";

function VercelIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1L24 22H0L12 1Z" />
    </svg>
  );
}

type SessionMode = "empty" | "repo";
const NO_VERCEL_PROJECT_VALUE = "__none__";

interface SessionStarterProps {
  onSubmit: (session: {
    repoOwner?: string;
    repoName?: string;
    branch?: string;
    cloneUrl?: string;
    isNewBranch: boolean;
    sandboxType: SandboxType;
    autoCommitPush: boolean;
    vercelProject?: VercelProjectSelection | null;
  }) => void;
  isLoading?: boolean;
  lastRepo: { owner: string; repo: string } | null;
}

function formatVercelProjectLabel(project: VercelProjectSelection): string {
  return project.teamSlug
    ? `${project.teamSlug} / ${project.projectName}`
    : project.projectName;
}

export function SessionStarter({
  onSubmit,
  isLoading,
  lastRepo,
}: SessionStarterProps) {
  const [mode, setMode] = useState<SessionMode>(() =>
    lastRepo ? "repo" : "empty",
  );
  const [selectedOwner, setSelectedOwner] = useState(
    () => lastRepo?.owner ?? "",
  );
  const [selectedRepo, setSelectedRepo] = useState(() => lastRepo?.repo ?? "");
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [isNewBranch, setIsNewBranch] = useState(!!lastRepo);
  const [vercelProjectChoice, setVercelProjectChoice] = useState<
    string | null | undefined
  >(undefined);

  const { session, loading: sessionLoading } = useSession();
  const { preferences, loading: preferencesLoading } = useUserPreferences();
  const defaultAutoCommitPush = preferences?.autoCommitPush ?? false;
  const [autoCommitPush, setAutoCommitPush] = useState<boolean | null>(null);
  const sandboxType = preferences?.defaultSandboxType ?? DEFAULT_SANDBOX_TYPE;
  const sandboxName =
    SANDBOX_OPTIONS.find((s) => s.id === sandboxType)?.name ?? sandboxType;

  const shouldLoadVercelProjects =
    mode === "repo" &&
    !!selectedOwner &&
    !!selectedRepo &&
    session?.authProvider === "vercel";
  const {
    data: repoProjects,
    loading: repoProjectsLoading,
    error: repoProjectsError,
  } = useVercelRepoProjects({
    enabled: shouldLoadVercelProjects,
    repoOwner: selectedOwner,
    repoName: selectedRepo,
  });

  useEffect(() => {
    if (!shouldLoadVercelProjects) {
      setVercelProjectChoice(undefined);
      return;
    }
    if (!repoProjects || repoProjectsLoading) return;
    if (repoProjects.selectedProjectId) {
      setVercelProjectChoice(repoProjects.selectedProjectId);
      return;
    }
    if (repoProjects.projects.length === 0) {
      setVercelProjectChoice(null);
      return;
    }
    setVercelProjectChoice(undefined);
  }, [repoProjects, repoProjectsLoading, shouldLoadVercelProjects]);

  const handleRepoSelect = (owner: string, repo: string) => {
    setSelectedOwner(owner);
    setSelectedRepo(repo);
    setSelectedBranch(null);
    setIsNewBranch(false);
    setVercelProjectChoice(undefined);
  };

  const handleRepoClear = () => {
    setSelectedOwner("");
    setSelectedRepo("");
    setSelectedBranch(null);
    setIsNewBranch(false);
    setVercelProjectChoice(undefined);
  };

  const handleBranchChange = (branch: string | null, newBranch: boolean) => {
    setSelectedBranch(branch);
    setIsNewBranch(newBranch);
  };

  const handleModeChange = (newMode: SessionMode) => {
    setMode(newMode);
    if (newMode === "empty") handleRepoClear();
  };

  const isRepoSelectionComplete =
    mode !== "repo" || (selectedOwner && selectedRepo);
  const isVercelLookupPending =
    mode === "repo" &&
    !!selectedOwner &&
    !!selectedRepo &&
    (sessionLoading || (shouldLoadVercelProjects && repoProjectsLoading));
  const requiresVercelChoice =
    shouldLoadVercelProjects &&
    !repoProjectsLoading &&
    !repoProjectsError &&
    !!repoProjects &&
    repoProjects.projects.length > 0 &&
    repoProjects.selectedProjectId === null &&
    vercelProjectChoice === undefined;
  const controlsDisabled = isLoading || preferencesLoading;
  const isSubmitDisabled =
    controlsDisabled ||
    !isRepoSelectionComplete ||
    isVercelLookupPending ||
    requiresVercelChoice;
  const effectiveAutoCommitPush = autoCommitPush ?? defaultAutoCommitPush;
  const showVercelProjectSection =
    mode === "repo" &&
    !!selectedOwner &&
    !!selectedRepo &&
    (sessionLoading || session?.authProvider === "vercel");

  const handleSubmit = () => {
    if (isSubmitDisabled) return;

    let vercelProject: VercelProjectSelection | null | undefined;
    if (shouldLoadVercelProjects) {
      if (repoProjectsError || !repoProjects) {
        vercelProject = undefined;
      } else if (vercelProjectChoice === null) {
        vercelProject = null;
      } else if (typeof vercelProjectChoice === "string") {
        vercelProject =
          repoProjects.projects.find(
            (project) => project.projectId === vercelProjectChoice,
          ) ?? null;
      } else {
        return;
      }
    }

    onSubmit({
      repoOwner: mode === "repo" ? selectedOwner || undefined : undefined,
      repoName: mode === "repo" ? selectedRepo || undefined : undefined,
      branch: mode === "repo" ? selectedBranch || undefined : undefined,
      cloneUrl:
        mode === "repo" && selectedOwner && selectedRepo
          ? `https://github.com/${selectedOwner}/${selectedRepo}`
          : undefined,
      isNewBranch: mode === "repo" ? isNewBranch : false,
      sandboxType,
      autoCommitPush: effectiveAutoCommitPush,
      vercelProject,
    });
  };

  const buttonLabel =
    mode === "repo" && selectedOwner && selectedRepo
      ? `Start with ${selectedOwner}/${selectedRepo}`
      : "Start session";

  return (
    <div
      className={cn(
        "w-full max-w-2xl overflow-hidden rounded-xl border border-border/70 bg-card/80 p-4 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/75 dark:border-white/10 dark:bg-neutral-900/60 dark:shadow-none sm:p-5",
        "transition-all duration-200",
      )}
    >
      <div className="flex flex-col gap-4">
        <div className="flex rounded-lg bg-muted/70 p-1 dark:bg-white/[0.04]">
          <button
            type="button"
            onClick={() => handleModeChange("empty")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all",
              mode === "empty"
                ? "border border-border/70 bg-background text-foreground shadow-sm dark:border-transparent dark:bg-white/10 dark:text-neutral-100"
                : "text-muted-foreground hover:text-foreground dark:text-neutral-400 dark:hover:text-neutral-300",
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            Empty sandbox
          </button>
          <button
            type="button"
            onClick={() => handleModeChange("repo")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all",
              mode === "repo"
                ? "border border-border/70 bg-background text-foreground shadow-sm dark:border-transparent dark:bg-white/10 dark:text-neutral-100"
                : "text-muted-foreground hover:text-foreground dark:text-neutral-400 dark:hover:text-neutral-300",
            )}
          >
            <GitBranch className="h-3.5 w-3.5" />
            From repository
          </button>
        </div>

        {mode === "repo" && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <RepoSelectorCompact
                  selectedOwner={selectedOwner}
                  selectedRepo={selectedRepo}
                  onSelect={handleRepoSelect}
                />
              </div>
              {selectedOwner && selectedRepo && (
                <button
                  type="button"
                  onClick={handleRepoClear}
                  className="flex items-center justify-center self-stretch rounded-md border border-input bg-background/80 px-3 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-500 dark:hover:border-white/20 dark:hover:bg-white/[0.06] dark:hover:text-neutral-300"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {selectedOwner && selectedRepo && (
              <BranchSelectorCompact
                owner={selectedOwner}
                repo={selectedRepo}
                value={selectedBranch}
                isNewBranch={isNewBranch}
                onChange={handleBranchChange}
              />
            )}

            {showVercelProjectSection && (
              <div className="overflow-hidden rounded-lg border border-border/70 dark:border-white/10">
                <div className="flex items-start gap-3 bg-muted/30 px-3.5 py-3 dark:bg-white/[0.025]">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background dark:border-white/10 dark:bg-white/[0.06]">
                    <VercelIcon className="h-3 w-3" />
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium leading-snug">
                      Environment sync
                    </p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Pull Development env vars into{" "}
                      <code className="rounded bg-muted px-1 py-0.5 text-[11px] dark:bg-white/[0.06]">
                        .env.local
                      </code>{" "}
                      when the sandbox is created.
                    </p>
                  </div>
                </div>
                <div className="border-t border-border/70 px-3.5 py-3 dark:border-white/10">
                  {isVercelLookupPending ? (
                    <div className="flex items-center gap-2.5 py-0.5">
                      <SearchIcon className="h-3.5 w-3.5 animate-pulse text-muted-foreground/70" />
                      <span className="text-xs text-muted-foreground">
                        Scanning for linked Vercel projects&hellip;
                      </span>
                    </div>
                  ) : repoProjectsError ? (
                    <div className="flex items-start gap-2.5">
                      <AlertCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {repoProjectsError}. Will fall back to any saved repo
                        default.
                      </p>
                    </div>
                  ) : repoProjects?.projects.length === 0 ? (
                    <div className="flex items-start gap-2.5">
                      <XCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        No linked Vercel projects found for this repo. The
                        session will start without env sync.
                      </p>
                    </div>
                  ) : repoProjects ? (
                    <div className="space-y-2">
                      <Select
                        value={
                          vercelProjectChoice === null
                            ? NO_VERCEL_PROJECT_VALUE
                            : vercelProjectChoice
                        }
                        onValueChange={(value) =>
                          setVercelProjectChoice(
                            value === NO_VERCEL_PROJECT_VALUE ? null : value,
                          )
                        }
                        disabled={controlsDisabled}
                      >
                        <SelectTrigger className="w-full bg-background/80 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]">
                          <SelectValue placeholder="Select a Vercel project&hellip;" />
                        </SelectTrigger>
                        <SelectContent align="start">
                          {repoProjects.projects.map((project) => (
                            <SelectItem key={project.projectId} value={project.projectId}>
                              <span className="flex items-center gap-2">
                                <VercelIcon className="h-3 w-3 shrink-0 opacity-60" />
                                {formatVercelProjectLabel(project)}
                              </span>
                            </SelectItem>
                          ))}
                          <SelectSeparator />
                          <SelectItem value={NO_VERCEL_PROJECT_VALUE}>
                            <span className="text-muted-foreground">
                              Don&apos;t sync env variables
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {requiresVercelChoice && (
                        <p className="text-xs text-amber-600 dark:text-amber-400/80">
                          Select a project to sync, or opt out for this session.
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        )}

        {mode === "empty" && (
          <p className="text-center text-sm text-muted-foreground dark:text-neutral-500">
            Start with a blank sandbox -- no repository required.
          </p>
        )}

        <div className="flex items-center justify-between gap-4 rounded-md border border-border/70 bg-muted/20 px-3 py-2 dark:border-white/10 dark:bg-white/[0.02]">
          <div className="space-y-1">
            <p className="text-sm font-medium">Auto commit and push</p>
            <p className="text-xs text-muted-foreground">
              Automatically commit and push after each agent turn.
            </p>
          </div>
          <Switch
            checked={effectiveAutoCommitPush}
            onCheckedChange={setAutoCommitPush}
            disabled={controlsDisabled}
          />
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitDisabled}
          className={cn(
            "w-full rounded-md px-4 py-2 text-sm font-medium transition-colors",
            isSubmitDisabled
              ? "cursor-not-allowed bg-muted text-muted-foreground"
              : "bg-foreground text-background hover:bg-foreground/90",
          )}
        >
          {buttonLabel}
        </button>

        <p className="text-center text-xs text-muted-foreground">
          Using {sandboxName} sandbox{" "}
          <span className="text-muted-foreground/60">&middot;</span>{" "}
          <Link
            href="/settings/preferences"
            className="text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 transition-colors hover:text-foreground hover:decoration-foreground/40"
          >
            Change
          </Link>
        </p>
      </div>
    </div>
  );
}
