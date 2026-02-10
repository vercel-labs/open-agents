"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { RepoSelectorCompact } from "./repo-selector-compact";
import { BranchSelectorCompact } from "./branch-selector-compact";
import {
  SANDBOX_OPTIONS,
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

  const { preferences } = useUserPreferences();

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
      sandboxType,
    });
  };

  return (
    <div
      className={cn(
        "w-full max-w-2xl overflow-hidden rounded-xl border border-white/10 bg-neutral-900/60 p-4 sm:p-5",
        "transition-all duration-200",
      )}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-neutral-400">
            Repository
          </label>
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
                className="flex items-center justify-center self-stretch rounded-md border border-white/10 bg-white/[0.03] px-3 text-neutral-500 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-neutral-300"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {selectedOwner && selectedRepo && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-neutral-400">
              Branch
            </label>
            <BranchSelectorCompact
              owner={selectedOwner}
              repo={selectedRepo}
              value={selectedBranch}
              isNewBranch={isNewBranch}
              onChange={handleBranchChange}
            />
          </div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isLoading}
          className={cn(
            "w-full rounded-md px-4 py-2 text-sm font-medium transition-colors",
            isLoading
              ? "cursor-not-allowed bg-neutral-700 text-neutral-400"
              : "bg-neutral-200 text-neutral-900 hover:bg-neutral-300",
          )}
        >
          Start session
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
