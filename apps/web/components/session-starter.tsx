"use client";

import { GitBranch, Plus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { cn } from "@/lib/utils";
import { BranchSelectorCompact } from "./branch-selector-compact";
import { RepoSelectorCompact } from "./repo-selector-compact";
import {
  DEFAULT_SANDBOX_TYPE,
  SANDBOX_OPTIONS,
  type SandboxType,
} from "./sandbox-selector-compact";
import { Switch } from "./ui/switch";

type SessionMode = "empty" | "repo";

interface SessionStarterProps {
  onSubmit: (session: {
    repoOwner?: string;
    repoName?: string;
    branch?: string;
    cloneUrl?: string;
    isNewBranch: boolean;
    sandboxType: SandboxType;
    autoCommitPush: boolean;
  }) => void;
  isLoading?: boolean;
  lastRepo: { owner: string; repo: string } | null;
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

  const { preferences, loading: preferencesLoading } = useUserPreferences();

  const defaultAutoCommitPush = preferences?.autoCommitPush ?? false;
  const [autoCommitPush, setAutoCommitPush] = useState<boolean | null>(null);

  const sandboxType = preferences?.defaultSandboxType ?? DEFAULT_SANDBOX_TYPE;
  const sandboxName =
    SANDBOX_OPTIONS.find((s) => s.id === sandboxType)?.name ?? sandboxType;

  const handleRepoSelect = (owner: string, repo: string) => {
    setSelectedOwner(owner);
    setSelectedRepo(repo);
    setSelectedBranch(null);
    setIsNewBranch(false);
  };

  const handleRepoClear = () => {
    setSelectedOwner("");
    setSelectedRepo("");
    setSelectedBranch(null);
    setIsNewBranch(false);
  };

  const handleBranchChange = (branch: string | null, newBranch: boolean) => {
    setSelectedBranch(branch);
    setIsNewBranch(newBranch);
  };

  const handleModeChange = (newMode: SessionMode) => {
    setMode(newMode);
    if (newMode === "empty") {
      handleRepoClear();
    }
  };

  const isRepoSelectionComplete =
    mode !== "repo" || (selectedOwner && selectedRepo);
  const controlsDisabled = isLoading || preferencesLoading;
  const isSubmitDisabled = controlsDisabled || !isRepoSelectionComplete;
  const effectiveAutoCommitPush = autoCommitPush ?? defaultAutoCommitPush;

  const handleSubmit = () => {
    if (isSubmitDisabled) return;

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
        {/* Segmented toggle */}
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

        {/* Repo mode: show repo/branch pickers */}
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
          </div>
        )}

        {/* Empty mode: brief description */}
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
