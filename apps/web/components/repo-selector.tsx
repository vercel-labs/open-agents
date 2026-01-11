"use client";

import { useState, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

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
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadOwners = async () => {
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
        setLoading(false);
      }
    };

    loadOwners();
  }, []);

  useEffect(() => {
    if (!selectedOwner) return;

    const loadRepos = async () => {
      try {
        const res = await fetch(`/api/github/repos?owner=${selectedOwner}`);
        const data = (await res.json()) as Repo[];
        setRepos(data);
      } catch (error) {
        console.error("Failed to load repos:", error);
      }
    };

    loadRepos();
  }, [selectedOwner]);

  const handleOwnerChange = (value: string) => {
    setSelectedOwner(value);
    setSelectedRepo("");
  };

  const handleRepoChange = (value: string) => {
    setSelectedRepo(value);
    onRepoSelect(selectedOwner, value);
  };

  if (loading) return <div>Loading...</div>;

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
      <Select value={selectedOwner} onValueChange={handleOwnerChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select owner" />
        </SelectTrigger>
        <SelectContent>
          {owners.map((owner) => (
            <SelectItem key={owner.login} value={owner.login}>
              {owner.login}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={selectedRepo}
        onValueChange={handleRepoChange}
        disabled={!selectedOwner}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select repository" />
        </SelectTrigger>
        <SelectContent>
          {repos.map((repo) => (
            <SelectItem key={repo.full_name} value={repo.name}>
              {repo.name} {repo.private && "(private)"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
