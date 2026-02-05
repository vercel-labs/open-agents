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
import { fetcher } from "@/lib/swr";
import { cn } from "@/lib/utils";

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
  const [open, setOpen] = useState(false);
  const [currentOwner, setCurrentOwner] = useState(selectedOwner);
  const [repoSearch, setRepoSearch] = useState("");
  const [debouncedRepoSearch, setDebouncedRepoSearch] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { mutate } = useSWRConfig();

  // Track whether we've auto-selected an owner
  const hasAutoSelectedRef = useRef(false);

  // Fetch owners (user + orgs)
  const { data: owners = [], isLoading: ownersLoading } = useSWR<Owner[]>(
    "github-owners",
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
    ? `${selectedOwner}/${selectedRepo}`.length > 20
      ? `${selectedRepo.slice(0, 18)}...`
      : selectedRepo
    : "Select repo...";

  const isInitialLoading = ownersLoading && owners.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-300"
        >
          {isInitialLoading ? (
            <Loader2Icon className="h-4 w-4 animate-spin" />
          ) : (
            <Folder className="h-4 w-4" />
          )}
          <span className="max-w-[150px] truncate">
            {isInitialLoading ? "Loading..." : displayText}
          </span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
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
      </PopoverContent>
    </Popover>
  );
}
