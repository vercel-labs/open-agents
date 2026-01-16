"use client";

import { useState, useEffect, useRef } from "react";
import {
  Folder,
  ChevronDown,
  CheckIcon,
  LockIcon,
  Loader2Icon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

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

export function RepoSelectorCompact({
  selectedOwner,
  selectedRepo,
  onSelect,
}: RepoSelectorCompactProps) {
  const [open, setOpen] = useState(false);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [currentOwner, setCurrentOwner] = useState(selectedOwner);
  const [ownersLoading, setOwnersLoading] = useState(true);
  const [reposLoading, setReposLoading] = useState(false);

  // Use ref to track if we've already set a default owner
  const hasSetDefaultOwner = useRef(false);

  useEffect(() => {
    const loadOwners = async () => {
      setOwnersLoading(true);
      try {
        const [userRes, orgsRes] = await Promise.all([
          fetch("/api/github/user"),
          fetch("/api/github/orgs"),
        ]);

        if (!userRes.ok) return;

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
        if (!hasSetDefaultOwner.current && allOwners[0]) {
          hasSetDefaultOwner.current = true;
          setCurrentOwner(allOwners[0].login);
        }
      } catch (err) {
        console.error("Failed to load owners:", err);
      } finally {
        setOwnersLoading(false);
      }
    };

    loadOwners();
  }, []);

  useEffect(() => {
    if (!currentOwner) return;

    const loadRepos = async () => {
      setReposLoading(true);
      setRepos([]);
      try {
        const res = await fetch(`/api/github/repos?owner=${currentOwner}`);
        const data = (await res.json()) as Repo[];
        setRepos(data);
      } catch (error) {
        console.error("Failed to load repos:", error);
      } finally {
        setReposLoading(false);
      }
    };

    loadRepos();
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
          <CommandInput placeholder="Search repositories..." />
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

            {/* Repos for current owner */}
            <CommandGroup heading="Repositories">
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
                repos.map((repo) => (
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
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
