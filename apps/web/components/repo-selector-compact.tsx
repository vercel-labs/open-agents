"use client";

import {
  CheckIcon,
  ChevronDown,
  ExternalLink,
  Folder,
  Loader2Icon,
  LockIcon,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { z } from "zod";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  const [open, setOpen] = useState(false);
  const [currentOwner, setCurrentOwner] = useState(selectedOwner);
  const [repoSearch, setRepoSearch] = useState("");
  const [debouncedRepoSearch, setDebouncedRepoSearch] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Track whether we've auto-selected an owner
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

  // Revalidate cache and refetch repos
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
    setOpen(false);
  };

  const displayText = selectedRepo
    ? `${selectedOwner}/${selectedRepo}`
    : "Select repository...";

  const isInitialLoading = installationsLoading && installations.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen} modal={true}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md border border-input bg-background/80 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-400 dark:hover:border-white/20 dark:hover:bg-white/[0.06] dark:hover:text-neutral-300"
        >
          {isInitialLoading ? (
            <Loader2Icon className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <Folder className="h-4 w-4 shrink-0" />
          )}
          <span className="flex-1 truncate text-left">
            {isInitialLoading ? "Loading..." : displayText}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        {!sessionLoading && !hasGitHub ? (
          <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
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
        ) : !installationsLoading && installations.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
            <GitHubIcon className="size-8 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Install GitHub App</p>
              <p className="text-xs text-muted-foreground">
                Install the GitHub App to choose which repositories are
                available.
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
        ) : (
          <Command>
            <CommandInput
              placeholder="Search repositories..."
              value={repoSearch}
              onValueChange={setRepoSearch}
            />
            <CommandList>
              <CommandEmpty>
                {reposError
                  ? reposError
                  : installationsLoading || reposLoading
                    ? "Loading..."
                    : "No repositories found."}
              </CommandEmpty>

              {/* Owner selector */}
              <CommandGroup heading="Account">
                {installationsLoading && installations.length === 0 ? (
                  <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin" />
                    <span>Loading accounts...</span>
                  </div>
                ) : (
                  installations.map((installation) => (
                    <CommandItem
                      key={installation.installationId}
                      value={`owner:${installation.accountLogin}`}
                      onSelect={() =>
                        setCurrentOwner(installation.accountLogin)
                      }
                    >
                      <CheckIcon
                        className={cn(
                          "mr-2 size-4",
                          currentOwner === installation.accountLogin
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      <span>{installation.accountLogin}</span>
                    </CommandItem>
                  ))
                )}
              </CommandGroup>

              <CommandSeparator />
              <div className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground">
                <span>
                  Showing repos for{" "}
                  <span className="text-foreground">{currentOwner}</span>
                </span>
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
              <div className="flex items-center justify-between px-2 pb-1 text-xs">
                {currentInstallation?.installationUrl ? (
                  <Link
                    href={currentInstallation.installationUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Manage repository access
                    <ExternalLink className="size-3" />
                  </Link>
                ) : (
                  <span className="text-muted-foreground">&nbsp;</span>
                )}
                <button
                  type="button"
                  onClick={startGitHubInstall}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  Install to organization
                </button>
              </div>

              {/* Repos for current owner */}
              <CommandGroup>
                {reposLoading ? (
                  <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin" />
                    <span>Loading repositories...</span>
                  </div>
                ) : repos.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    No repositories found.
                  </div>
                ) : (
                  repos.slice(0, 50).map((repo) => (
                    <CommandItem
                      key={repo.full_name}
                      value={repo.name}
                      onSelect={() => handleRepoSelect(repo)}
                    >
                      <CheckIcon
                        className={cn(
                          "mr-2 size-4",
                          selectedRepo === repo.name &&
                            selectedOwner === currentOwner
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      <span className="truncate">{repo.name}</span>
                      {repo.private && (
                        <LockIcon className="ml-auto size-3 text-muted-foreground" />
                      )}
                    </CommandItem>
                  ))
                )}
                {repos.length === 50 && !debouncedRepoSearch && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Showing first 50 results. Use search to narrow.
                  </div>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}
