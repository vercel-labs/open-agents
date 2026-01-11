"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, Mic, ArrowUp, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { RepoSelectorCompact } from "./repo-selector-compact";
import { BranchSelectorCompact } from "./branch-selector-compact";

interface TaskInputProps {
  onSubmit: (task: {
    prompt: string;
    repoOwner?: string;
    repoName?: string;
    branch?: string;
    cloneUrl?: string;
  }) => void;
  isLoading?: boolean;
}

export function TaskInput({ onSubmit, isLoading }: TaskInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [selectedOwner, setSelectedOwner] = useState("");
  const [selectedRepo, setSelectedRepo] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle click outside to collapse
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        if (!prompt.trim()) {
          setIsFocused(false);
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [prompt]);

  const handleSubmit = () => {
    if (!prompt.trim() || isLoading) return;

    onSubmit({
      prompt: prompt.trim(),
      repoOwner: selectedOwner || undefined,
      repoName: selectedRepo || undefined,
      branch: selectedBranch || undefined,
      cloneUrl:
        selectedOwner && selectedRepo
          ? `https://github.com/${selectedOwner}/${selectedRepo}`
          : undefined,
    });
    setPrompt("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleRepoSelect = (owner: string, repo: string) => {
    setSelectedOwner(owner);
    setSelectedRepo(repo);
    setSelectedBranch(""); // Reset branch when repo changes
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "w-full max-w-2xl rounded-xl border border-border bg-muted/50 transition-all duration-200",
        isFocused && "bg-muted",
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <button
          type="button"
          className="mt-0.5 text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-5 w-5" />
        </button>

        <textarea
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder="Describe a task"
          rows={1}
          className="flex-1 resize-none bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
          style={{
            minHeight: "24px",
            height: "auto",
          }}
        />

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
          >
            <Mic className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!prompt.trim() || isLoading}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
              prompt.trim() && !isLoading
                ? "bg-foreground text-background hover:bg-foreground/90"
                : "bg-muted-foreground/20 text-muted-foreground",
            )}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Repo and branch selection */}
      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        <RepoSelectorCompact
          selectedOwner={selectedOwner}
          selectedRepo={selectedRepo}
          onSelect={handleRepoSelect}
        />

        {selectedOwner && selectedRepo && (
          <BranchSelectorCompact
            owner={selectedOwner}
            repo={selectedRepo}
            value={selectedBranch}
            onChange={setSelectedBranch}
          />
        )}

        <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-muted-foreground">
          <Layers className="h-4 w-4" />
          <span>2x</span>
        </div>
      </div>
    </div>
  );
}
