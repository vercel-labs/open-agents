"use client";

import {
  CheckIcon,
  ChevronDown,
  ExternalLink,
  Loader2Icon,
  LockIcon,
  RefreshCw,
  SearchIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { z } from "zod";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  InstallationRepo,
  useInstallationRepos,
} from "@/hooks/use-installation-repos";
import { useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

interface Installation {
  installationId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  repositorySelection: "all" | "selected";
  installationUrl: string | null;
}

const installationSchema = z.object({
  installationId: z.number(),
  accountLogin: z.string(),
  accountType: z.enum(["User", "Organization"]),
  repositorySelection: z.enum(["all", "selected"]),
  installationUrl: z.string().nullable(),
});

const installationsSchema = z.array(installationSchema);

interface RepoSelectorCompactProps {
  selectedOwner: string;
  selectedRepo: string;
  onSelect: (owner: string, repo: string) => void;
}

function getCurrentPathWithSearch(): string {
  return `${window.location.pathname}${window.location.search}`;
}

async function fetchInstallations(): Promise<Installation[]> {
  const response = await fetch("/api/github/installations");
  if (!response.ok) {
    return [];
  }

  const json = await response.json();
  const parsed = installationsSchema.safeParse(json);

  return parsed.success ? parsed.data : [];
}

export function RepoSelectorCompact({
  selectedOwner,
  selectedRepo,
  onSelect,
}: RepoSelectorCompactProps) {
  const { hasGitHub, loading: sessionLoading } = useSession();
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [currentOwner, setCurrentOwner] = useState(selectedOwner);
  const [repoSearch, setRepoSearch] = useState("");
  const [debouncedRepoSearch, setDebouncedRepoSearch] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const hasAutoSelectedRef = useRef(false);

  const startGitHubInstall = useCallback(() => {
    const params = new URLSearchParams({
      next: getCurrentPathWithSearch(),
    });
    window.location.href = `/api/github/app/install?${params.toString()}`;
  }, []);

  const { data: installations = [], isLoading: installationsLoading } = useSWR<
    Installation[]
  >(hasGitHub ? "github-installations" : null, fetchInstallations);

  const currentInstallation = installations.find(
    (installation) => installation.accountLogin === currentOwner,
  );

  const {
    repos,
    isLoading: reposLoading,
    error: reposError,
    refresh: refreshRepos,
  } = useInstallationRepos({
    installationId: currentInstallation?.installationId ?? null,
    query: debouncedRepoSearch,
    limit: 50,
  });

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refreshRepos();
    } catch (refreshError) {
      console.error("Failed to refresh repositories:", refreshError);
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshRepos]);

  // Auto-select first owner when data loads (only once)
  useEffect(() => {
    if (installations[0] && !currentOwner && !hasAutoSelectedRef.current) {
      hasAutoSelectedRef.current = true;
      setCurrentOwner(installations[0].accountLogin);
    }
  }, [installations, currentOwner]);

  const lastSelectedOwnerRef = useRef(selectedOwner);

  // Sync currentOwner with selectedOwner prop when the parent changes it.
  useEffect(() => {
    if (selectedOwner === lastSelectedOwnerRef.current) {
      return;
    }

    lastSelectedOwnerRef.current = selectedOwner;
    setCurrentOwner(selectedOwner);
  }, [selectedOwner]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedRepoSearch(repoSearch.trim());
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [repoSearch]);

  useEffect(() => {
    setRepoSearch("");
  }, [currentOwner]);

  const handleRepoSelect = (repo: InstallationRepo) => {
    onSelect(currentOwner, repo.name);
  };

  const isInitialLoading = installationsLoading && installations.length === 0;

  // Not connected to GitHub
  if (!sessionLoading && !hasGitHub) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border/70 px-4 py-6 text-center dark:border-white/10">
        <GitHubIcon className="size-8 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Install GitHub App</p>
          <p className="text-xs text-muted-foreground">
            Continue on GitHub to choose which repositories are available.
          </p>
        </div>
        <button
          type="button"
          onClick={startGitHubInstall}
          className="rounded-md bg-neutral-200 px-4 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-300"
        >
          Choose repositories
        </button>
      </div>
    );
  }

  // No installations
  if (!installationsLoading && installations.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border/70 px-4 py-6 text-center dark:border-white/10">
        <GitHubIcon className="size-8 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Install GitHub App</p>
          <p className="text-xs text-muted-foreground">
            Install the GitHub App to choose which repositories are available.
          </p>
        </div>
        <button
          type="button"
          onClick={startGitHubInstall}
          className="rounded-md bg-neutral-200 px-4 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-300"
        >
          Choose repositories
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0">
      {/* Top bar: org dropdown + search */}
      <div className="flex items-stretch gap-0 overflow-hidden rounded-t-lg border border-border/70 dark:border-white/10">
        {/* Org dropdown */}
        <Popover open={ownerOpen} onOpenChange={setOwnerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex shrink-0 items-center gap-2 border-r border-border/70 bg-background/80 px-3 py-2 text-sm transition-colors hover:bg-accent dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
            >
              <GitHubIcon className="size-4 shrink-0" />
              {isInitialLoading ? (
                <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
              ) : (
                <span className="max-w-[140px] truncate font-medium">
                  {currentOwner || "Select account"}
                </span>
              )}
              <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[220px] p-0" align="start">
            <Command>
              <CommandList>
                <CommandGroup>
                  {installations.map((installation) => (
                    <CommandItem
                      key={installation.installationId}
                      value={installation.accountLogin}
                      onSelect={() => {
                        setCurrentOwner(installation.accountLogin);
                        setOwnerOpen(false);
                      }}
                    >
                      <GitHubIcon className="size-3.5" />
                      <span className="truncate">
                        {installation.accountLogin}
                      </span>
                      <CheckIcon
                        className={cn(
                          "ml-auto size-3.5",
                          currentOwner === installation.accountLogin
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
                <div className="border-t border-border/70 p-1 dark:border-white/10">
                  <button
                    type="button"
                    onClick={() => {
                      startGitHubInstall();
                      setOwnerOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <ExternalLink className="size-3.5" />
                    Add organization
                  </button>
                </div>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Search input */}
        <div className="flex flex-1 items-center gap-2 bg-background/80 px-3 dark:bg-white/[0.03]">
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search repositories..."
            value={repoSearch}
            onChange={(e) => setRepoSearch(e.target.value)}
            className="h-full w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          {repoSearch && (
            <button
              type="button"
              onClick={() => setRepoSearch("")}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Esc
            </button>
          )}
        </div>
      </div>

      {/* Repo list */}
      <div className="max-h-[280px] overflow-y-auto rounded-b-lg border border-t-0 border-border/70 dark:border-white/10">
        {reposLoading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            <span>Loading repositories...</span>
          </div>
        ) : reposError ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {reposError}
          </div>
        ) : repos.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No repositories found.
          </div>
        ) : (
          <div className="divide-y divide-border/50 dark:divide-white/[0.06]">
            {repos.slice(0, 50).map((repo) => {
              const isSelected =
                selectedRepo === repo.name && selectedOwner === currentOwner;

              return (
                <div
                  key={repo.full_name}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 transition-colors",
                    isSelected
                      ? "bg-accent/50 dark:bg-white/[0.04]"
                      : "hover:bg-accent/30 dark:hover:bg-white/[0.03]",
                  )}
                >
                  <GitHubIcon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {repo.name}
                    </span>
                    {repo.private && (
                      <LockIcon className="size-3 shrink-0 text-muted-foreground" />
                    )}
                    {repo.description && (
                      <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                        {repo.description}
                      </span>
                    )}
                  </div>
                  {isSelected ? (
                    <span className="shrink-0 rounded-md border border-border/70 bg-accent px-3 py-1 text-xs font-medium text-foreground dark:border-white/10 dark:bg-white/10">
                      Selected
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleRepoSelect(repo)}
                      className="shrink-0 rounded-md border border-border/70 bg-background px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent dark:border-white/20 dark:bg-white/[0.06] dark:hover:bg-white/10"
                    >
                      Select
                    </button>
                  )}
                </div>
              );
            })}
            {repos.length === 50 && !debouncedRepoSearch && (
              <div className="px-4 py-2.5 text-center text-xs text-muted-foreground">
                Showing first 50 results. Use search to narrow.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer: manage access + refresh */}
      <div className="mt-1.5 flex items-center justify-between px-1 text-xs">
        <div className="flex items-center gap-3">
          {currentInstallation?.installationUrl && (
            <Link
              href={currentInstallation.installationUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              Manage access
              <ExternalLink className="size-3" />
            </Link>
          )}
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw
            className={cn("size-3", isRefreshing && "animate-spin")}
          />
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>
    </div>
  );
}
