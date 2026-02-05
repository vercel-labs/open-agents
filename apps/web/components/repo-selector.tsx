"use client";

import {
  BookIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  LockIcon,
  RefreshCw,
  UserIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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

export function RepoSelector({
  onRepoSelect,
}: {
  onRepoSelect: (owner: string, repo: string) => void;
}) {
  const [owners, setOwners] = useState<Owner[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedOwner, setSelectedOwner] = useState("");
  const [selectedRepo, setSelectedRepo] = useState("");
  const [ownersLoading, setOwnersLoading] = useState(true);
  const [reposLoading, setReposLoading] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [repoOpen, setRepoOpen] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  const [debouncedRepoSearch, setDebouncedRepoSearch] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [repoRefreshTrigger, setRepoRefreshTrigger] = useState(0);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadOwners = async () => {
      setOwnersLoading(true);
      try {
        const [userRes, orgsRes] = await Promise.all([
          fetch("/api/github/user"),
          fetch("/api/github/orgs"),
        ]);

        if (!userRes.ok) {
          const data = await userRes.json().catch(() => ({}));
          setError(data.error || "Failed to fetch GitHub user");
          return;
        }

        const user = (await userRes.json()) as Owner;
        const orgs = orgsRes.ok ? ((await orgsRes.json()) as Owner[]) : [];

        const allOwners = [
          {
            login: user.login,
            name: user.name || user.login,
            avatar_url: user.avatar_url,
          },
          ...orgs,
        ];
        setOwners(allOwners);
        setSelectedOwner(allOwners[0]?.login || "");
      } catch (err) {
        console.error("Failed to load owners:", err);
        setError("Failed to load GitHub data");
      } finally {
        setOwnersLoading(false);
      }
    };

    loadOwners();
  }, []);

  const loadRepos = useCallback(async () => {
    if (!selectedOwner) return;

    setReposLoading(true);
    setRepos([]);
    try {
      const params = new URLSearchParams({
        owner: selectedOwner,
        limit: "50",
      });
      if (debouncedRepoSearch) {
        params.set("query", debouncedRepoSearch);
      }
      const res = await fetch(`/api/github/repos?${params.toString()}`);
      const data = (await res.json()) as Repo[];
      setRepos(data);
    } catch (error) {
      console.error("Failed to load repos:", error);
    } finally {
      setReposLoading(false);
    }
  }, [selectedOwner, debouncedRepoSearch]);

  useEffect(() => {
    loadRepos();
  }, [loadRepos, repoRefreshTrigger]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // Revalidate the server cache
      await fetch("/api/github/repos/revalidate", { method: "POST" });
      // Trigger a refetch
      setRepoRefreshTrigger((v) => v + 1);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedRepoSearch(repoSearch.trim());
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [repoSearch]);

  useEffect(() => {
    setRepoSearch("");
  }, [selectedOwner]);

  const handleOwnerSelect = (ownerLogin: string) => {
    setSelectedOwner(ownerLogin);
    setSelectedRepo("");
    setOwnerOpen(false);
  };

  const handleRepoSelect = (repoName: string) => {
    setSelectedRepo(repoName);
    onRepoSelect(selectedOwner, repoName);
    setRepoOpen(false);
  };

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4">
        <p className="text-sm text-destructive">{error}</p>
        <Button
          variant="outline"
          onClick={() => {
            window.location.href = "/api/auth/signin/github";
          }}
        >
          Connect GitHub
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Popover open={ownerOpen} onOpenChange={setOwnerOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            aria-expanded={ownerOpen}
            className="w-48 justify-between"
          >
            <div className="flex items-center gap-2 truncate">
              <UserIcon className="size-4 shrink-0" />
              {ownersLoading ? (
                <span className="text-muted-foreground">Loading...</span>
              ) : selectedOwner ? (
                <span className="truncate">{selectedOwner}</span>
              ) : (
                <span className="text-muted-foreground">Select owner</span>
              )}
            </div>
            <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-0">
          <Command>
            <CommandInput placeholder="Search owners..." />
            <CommandList>
              <CommandEmpty>
                {ownersLoading ? "Loading..." : "No owners found."}
              </CommandEmpty>
              <CommandGroup>
                {owners.map((owner) => (
                  <CommandItem
                    key={owner.login}
                    value={owner.login}
                    onSelect={() => handleOwnerSelect(owner.login)}
                  >
                    <CheckIcon
                      className={cn(
                        "mr-2 size-4",
                        selectedOwner === owner.login
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    <span className="truncate">{owner.login}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Popover open={repoOpen} onOpenChange={setRepoOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            aria-expanded={repoOpen}
            className="w-64 justify-between"
            disabled={!selectedOwner}
          >
            <div className="flex items-center gap-2 truncate">
              <BookIcon className="size-4 shrink-0" />
              {reposLoading ? (
                <span className="text-muted-foreground">Loading...</span>
              ) : selectedRepo ? (
                <span className="truncate">{selectedRepo}</span>
              ) : (
                <span className="text-muted-foreground">Select repository</span>
              )}
            </div>
            <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0">
          <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
            <span>
              Showing repos for{" "}
              <span className="text-foreground">{selectedOwner}</span>
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
          <Command>
            <CommandInput
              placeholder="Search repositories..."
              value={repoSearch}
              onValueChange={setRepoSearch}
            />
            <CommandList>
              <CommandEmpty>
                {reposLoading ? "Loading..." : "No repositories found."}
              </CommandEmpty>
              <CommandGroup>
                {repos.slice(0, 50).map((repo) => (
                  <CommandItem
                    key={repo.full_name}
                    value={repo.name}
                    onSelect={() => handleRepoSelect(repo.name)}
                  >
                    <CheckIcon
                      className={cn(
                        "mr-2 size-4",
                        selectedRepo === repo.name
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    <span className="truncate">{repo.name}</span>
                    {repo.private && (
                      <LockIcon className="ml-auto size-3 text-muted-foreground" />
                    )}
                  </CommandItem>
                ))}
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
    </div>
  );
}
