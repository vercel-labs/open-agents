"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { RepoSelectorCompact } from "./repo-selector-compact";
import { BranchSelectorCompact } from "./branch-selector-compact";
import {
  SandboxSelectorCompact,
  DEFAULT_SANDBOX_TYPE,
  type SandboxType,
} from "./sandbox-selector-compact";

interface SessionStarterProps {
  onSubmit: (session: {
    repoOwner?: string;
    repoName?: string;
    branch?: string;
    cloneUrl?: string;
    isNewBranch: boolean;
    sandboxType: SandboxType;
  }) => void;
  isLoading?: boolean;
}

export function SessionStarter({ onSubmit, isLoading }: SessionStarterProps) {
  const [selectedOwner, setSelectedOwner] = useState("");
  const [selectedRepo, setSelectedRepo] = useState("");
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [isNewBranch, setIsNewBranch] = useState(false);
  const [selectedSandbox, setSelectedSandbox] =
    useState<SandboxType>(DEFAULT_SANDBOX_TYPE);

  const { preferences } = useUserPreferences();

  useEffect(() => {
    if (preferences?.defaultSandboxType) {
      setSelectedSandbox(preferences.defaultSandboxType);
    }
  }, [preferences]);

  const handleRepoSelect = (owner: string, repo: string) => {
    setSelectedOwner(owner);
    setSelectedRepo(repo);
    setSelectedBranch(null);
    setIsNewBranch(false);
  };

  const handleBranchChange = (branch: string | null, newBranch: boolean) => {
    setSelectedBranch(branch);
    setIsNewBranch(newBranch);
  };

  const handleSubmit = () => {
    if (isLoading) return;

    onSubmit({
      repoOwner: selectedOwner || undefined,
      repoName: selectedRepo || undefined,
      branch: selectedBranch || undefined,
      cloneUrl:
        selectedOwner && selectedRepo
          ? `https://github.com/${selectedOwner}/${selectedRepo}`
          : undefined,
      isNewBranch,
      sandboxType: selectedSandbox,
    });
  };

  return (
    <div
      className={cn(
        "w-full max-w-2xl overflow-hidden rounded-xl border border-white/10 bg-neutral-900/60 p-4 sm:p-5",
        "transition-all duration-200",
      )}
    >
      <div className="flex flex-col gap-3">
        <div className="text-xs font-medium tracking-wide text-neutral-400 uppercase">
          Session setup
        </div>
        <div className="text-sm text-muted-foreground">
          Pick a sandbox, optionally connect a repo, then start.
        </div>
        <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-black/30 p-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <SandboxSelectorCompact
              value={selectedSandbox}
              onChange={setSelectedSandbox}
            />
            <RepoSelectorCompact
              selectedOwner={selectedOwner}
              selectedRepo={selectedRepo}
              onSelect={handleRepoSelect}
            />
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
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isLoading}
            className={cn(
              "self-end rounded-md px-4 py-2 text-sm font-medium transition-colors sm:self-auto",
              isLoading
                ? "cursor-not-allowed bg-neutral-700 text-neutral-400"
                : "bg-neutral-200 text-neutral-900 hover:bg-neutral-300",
            )}
          >
            {selectedOwner && selectedRepo ? "Start session" : "Start empty"}
          </button>
        </div>
      </div>
    </div>
  );
}
