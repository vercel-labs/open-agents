"use client";

import { useState } from "react";
import { RepoSelector } from "./repo-selector";
import { BranchSelector } from "./branch-selector";
import { Button } from "@/components/ui/button";

interface RepoSelectionScreenProps {
  onSelect: (owner: string, repo: string, branch: string) => void;
  isLoading?: boolean;
}

export function RepoSelectionScreen({
  onSelect,
  isLoading,
}: RepoSelectionScreenProps) {
  const [selectedOwner, setSelectedOwner] = useState("");
  const [selectedRepo, setSelectedRepo] = useState("");
  const [branch, setBranch] = useState("main");

  const handleRepoSelect = (owner: string, repo: string) => {
    setSelectedOwner(owner);
    setSelectedRepo(repo);
  };

  const handleStart = () => {
    if (selectedOwner && selectedRepo) {
      onSelect(selectedOwner, selectedRepo, branch);
    }
  };

  const canStart = selectedOwner && selectedRepo && !isLoading;

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6">
        <h1 className="text-3xl font-light text-foreground">
          Select a repository
        </h1>
        <div className="flex flex-col gap-4">
          <RepoSelector onRepoSelect={handleRepoSelect} />
          <BranchSelector
            owner={selectedOwner}
            repo={selectedRepo}
            value={branch}
            onChange={setBranch}
          />
        </div>
        <Button onClick={handleStart} disabled={!canStart}>
          {isLoading ? "Creating sandbox..." : "Start"}
        </Button>
      </div>
    </div>
  );
}
