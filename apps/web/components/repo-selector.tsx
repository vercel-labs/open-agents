"use client";

import { useState, useEffect } from "react";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  UserIcon,
  BookIcon,
  LockIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
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

  useEffect(() => {
    if (!selectedOwner) return;

    const loadRepos = async () => {
      setReposLoading(true);
      setRepos([]);
      try {
        const res = await fetch(`/api/github/repos?owner=${selectedOwner}`);
        const data = (await res.json()) as Repo[];
        setRepos(data);
      } catch (error) {
        console.error("Failed to load repos:", error);
      } finally {
        setReposLoading(false);
      }
    };

    loadRepos();
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
          <Command>
            <CommandInput placeholder="Search repositories..." />
            <CommandList>
              <CommandEmpty>
                {reposLoading ? "Loading..." : "No repositories found."}
              </CommandEmpty>
              <CommandGroup>
                {repos.map((repo) => (
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
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
