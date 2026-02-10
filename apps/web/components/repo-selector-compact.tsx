"use client";

import {
  CheckIcon,
  ChevronDown,
  Folder,
  Loader2Icon,
  LockIcon,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
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
import { useSession } from "@/hooks/use-session";
import { fetcher } from "@/lib/swr";
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

interface Owner {
  login: string;
  name: string;
  avatar_url: string;
}

interface Repo {
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
}

interface RepoSelectorCompactProps {
  selectedOwner: string;
  selectedRepo: string;
  onSelect: (owner: string, repo: string) => void;
}

async function fetchOwners(): Promise<Owner[]> {
  const [userRes, orgsRes] = await Promise.all([
    fetch("/api/github/user"),
    fetch("/api/github/orgs"),
  ]);

  if (!userRes.ok) return [];

  const user = (await userRes.json()) as Owner;
  const orgs = orgsRes.ok ? ((await orgsRes.json()) as Owner[]) : [];

  return [
    {
      login: user.login,
      name: user.name || user.login,
      avatar_url: user.avatar_url,
    },
    ...orgs,
  ];
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
  const { mutate } = useSWRConfig();

  // Track whether we've auto-selected an owner
  const hasAutoSelectedRef = useRef(false);

  // Fetch owners (user + orgs) — skip when GitHub isn't linked
  const { data: owners = [], isLoading: ownersLoading } = useSWR<Owner[]>(
    hasGitHub ? "github-owners" : null,
    fetchOwners,
  );

  // Build the repos URL for current owner
  const reposUrl = currentOwner
    ? `/api/github/repos?${new URLSearchParams({
        owner: currentOwner,
        limit: "50",
        ...(debouncedRepoSearch ? { query: debouncedRepoSearch } : {}),
      }).toString()}`
    : null;

  // Fetch repos for current owner (conditional fetch)
  const { data: repos = [], isLoading: reposLoading } = useSWR<Repo[]>(
    reposUrl,
    fetcher,
  );

  // Revalidate cache and refetch repos
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // Revalidate the server cache
      await fetch("/api/github/repos/revalidate", { method: "POST" });
      // Then refetch the data - use regex to match all repo URLs for this owner
      await mutate(
        (key) =>
          typeof key === "string" &&
          key.startsWith("/api/github/repos?") &&
          key.includes(`owner=${currentOwner}`),
        undefined,
        { revalidate: true },
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [currentOwner, mutate]);

  // Auto-select first owner when data loads (only once)
  useEffect(() => {
    if (owners[0] && !currentOwner && !hasAutoSelectedRef.current) {
      hasAutoSelectedRef.current = true;
      setCurrentOwner(owners[0].login);
    }
  }, [owners, currentOwner]);

  // Sync currentOwner with selectedOwner prop
  useEffect(() => {
    if (selectedOwner && selectedOwner !== currentOwner) {
      setCurrentOwner(selectedOwner);
    }
  }, [selectedOwner, currentOwner]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedRepoSearch(repoSearch.trim());
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [repoSearch]);

  useEffect(() => {
    setRepoSearch("");
  }, [currentOwner]);

  const handleRepoSelect = (repo: Repo) => {
    onSelect(currentOwner, repo.name);
    setOpen(false);
  };

  const displayText = selectedRepo
    ? `${selectedOwner}/${selectedRepo}`
    : "Select repository...";

  const isInitialLoading = ownersLoading && owners.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-neutral-400 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-neutral-300"
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
              <p className="text-sm font-medium">Connect GitHub</p>
              <p className="text-xs text-muted-foreground">
                Link your GitHub account to access your repositories.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                window.location.href = "/api/auth/github/link";
              }}
              className="rounded-md bg-neutral-200 px-4 py-1.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-300"
            >
              Connect to GitHub
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
                {ownersLoading || reposLoading
                  ? "Loading..."
                  : "No repositories found."}
              </CommandEmpty>

              {/* Owner selector */}
              <CommandGroup heading="Account">
                {ownersLoading && owners.length === 0 ? (
                  <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin" />
                    <span>Loading accounts...</span>
                  </div>
                ) : (
                  owners.map((owner) => (
                    <CommandItem
                      key={owner.login}
                      value={`owner:${owner.login}`}
                      onSelect={() => setCurrentOwner(owner.login)}
                    >
                      <CheckIcon
                        className={cn(
                          "mr-2 size-4",
                          currentOwner === owner.login
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      <span>{owner.login}</span>
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
