"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, Mic, ArrowUp } from "lucide-react";
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
    isNewBranch: boolean;
  }) => void;
  isLoading?: boolean;
}

export function TaskInput({ onSubmit, isLoading }: TaskInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [selectedOwner, setSelectedOwner] = useState("");
  const [selectedRepo, setSelectedRepo] = useState("");
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [isNewBranch, setIsNewBranch] = useState(false);
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
      isNewBranch,
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
    setSelectedBranch(null); // Reset branch when repo changes
    setIsNewBranch(false);
  };

  const handleBranchChange = (branch: string | null, newBranch: boolean) => {
    setSelectedBranch(branch);
    setIsNewBranch(newBranch);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "w-full max-w-2xl overflow-hidden rounded-xl border border-white/10 bg-neutral-800/60 transition-all duration-200",
        isFocused && "border-white/15 bg-neutral-800/80",
      )}
    >
      {/* Input area */}
      <div className="px-5 pb-3 pt-4">
        <textarea
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question with /plan"
          rows={1}
          className="w-full resize-none bg-transparent text-base text-foreground placeholder:text-neutral-500 focus:outline-none"
          style={{
            minHeight: "24px",
            height: "auto",
          }}
        />
      </div>

      {/* Bottom toolbar */}
      <div className="flex items-center justify-between px-3 pb-3 pt-0">
        <div className="flex items-center">
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-300"
          >
            <Plus className="h-4 w-4" />
          </button>

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
              isNewBranch={isNewBranch}
              onChange={handleBranchChange}
            />
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-300"
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
                ? "bg-neutral-200 text-neutral-900 hover:bg-neutral-300"
                : "bg-neutral-700 text-neutral-500",
            )}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
