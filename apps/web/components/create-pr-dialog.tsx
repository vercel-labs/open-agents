"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Sparkles,
  ExternalLink,
  Check,
  Loader2,
  GitCommit,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Task } from "@/lib/db/schema";

interface CreatePRDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task;
  sandboxId: string | null;
}

interface GitActions {
  committed?: boolean;
  commitMessage?: string;
  pushed?: boolean;
}

export function CreatePRDialog({
  open,
  onOpenChange,
  task,
  sandboxId,
}: CreatePRDialogProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const [branches, setBranches] = useState<string[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [result, setResult] = useState<{ prUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gitActions, setGitActions] = useState<GitActions | null>(null);
  const [resolvedBranch, setResolvedBranch] = useState<string | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setTitle("");
      setBody("");
      setResult(null);
      setError(null);
      setGitActions(null);
      setResolvedBranch(null);
    }
  }, [open]);

  const fetchBranches = useCallback(async () => {
    setIsLoadingBranches(true);
    try {
      const res = await fetch(
        `/api/github/branches?owner=${task.repoOwner}&repo=${task.repoName}`,
      );
      if (!res.ok) {
        throw new Error("Failed to fetch branches");
      }
      const data = await res.json();
      setBranches(data.branches || []);
      // Set default to repo's default branch if available
      if (data.defaultBranch) {
        setBaseBranch(data.defaultBranch);
      }
    } catch (err) {
      console.error("Failed to fetch branches:", err);
      // Keep default "main" if fetch fails
      setBranches(["main"]);
    } finally {
      setIsLoadingBranches(false);
    }
  }, [task.repoOwner, task.repoName]);

  // Fetch branches when dialog opens
  useEffect(() => {
    if (open && task.repoOwner && task.repoName) {
      fetchBranches();
    }
  }, [open, task.repoOwner, task.repoName, fetchBranches]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          sandboxId,
          taskTitle: task.title,
          baseBranch,
          branchName: task.branch,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to generate PR content");
      }

      setTitle(data.title);
      setBody(data.body);
      if (data.gitActions) {
        setGitActions(data.gitActions);
      }
      if (data.branchName) {
        setResolvedBranch(data.branchName as string);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreate = async () => {
    setIsCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          repoUrl: task.cloneUrl,
          branchName: resolvedBranch ?? task.branch,
          title,
          body,
          baseBranch,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create PR");
      }

      setResult({ prUrl: data.prUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create PR");
    } finally {
      setIsCreating(false);
    }
  };

  const isDisabled = isGenerating || isCreating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Pull Request</DialogTitle>
          <DialogDescription>
            {task.repoOwner}/{task.repoName} - {task.branch}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          // Success state
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
              <Check className="h-6 w-6 text-green-500" />
            </div>
            <div className="text-center">
              <p className="font-medium">Pull request created successfully!</p>
              {/* External link to GitHub - not internal navigation */}
              {/* oxlint-disable-next-line nextjs/no-html-link-for-pages */}
              <a
                href={result.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-sm text-blue-500 hover:underline"
              >
                View on GitHub
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        ) : (
          // Form state
          <>
            <div className="grid gap-4 py-4">
              {/* Base Branch Select */}
              <div className="grid gap-2">
                <Label htmlFor="base-branch">Base branch</Label>
                <Select
                  value={baseBranch}
                  onValueChange={setBaseBranch}
                  disabled={isDisabled || isLoadingBranches}
                >
                  <SelectTrigger id="base-branch" className="w-full">
                    <SelectValue placeholder="Select base branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {isLoadingBranches ? (
                      <SelectItem value="loading" disabled>
                        Loading branches...
                      </SelectItem>
                    ) : (
                      branches.map((branch) => (
                        <SelectItem key={branch} value={branch}>
                          {branch}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Title Input */}
              <div className="grid gap-2">
                <Label htmlFor="pr-title">Title</Label>
                <Input
                  id="pr-title"
                  placeholder="Enter PR title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={isDisabled}
                />
              </div>

              {/* Body Textarea */}
              <div className="grid gap-2">
                <Label htmlFor="pr-body">Description</Label>
                <Textarea
                  id="pr-body"
                  placeholder="Enter PR description (optional)"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={isDisabled}
                  rows={6}
                  className="resize-y"
                />
              </div>

              {/* Git Actions Banner */}
              {gitActions && (gitActions.committed || gitActions.pushed) && (
                <div className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm">
                  <GitCommit className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div className="space-y-1">
                    {gitActions.committed && (
                      <p>
                        <span className="font-medium">Committed:</span>{" "}
                        <code className="rounded bg-background px-1 py-0.5 text-xs">
                          {gitActions.commitMessage}
                        </code>
                      </p>
                    )}
                    {gitActions.pushed && (
                      <p className="text-muted-foreground">
                        Branch pushed to origin
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Error Alert */}
              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={handleGenerate}
                disabled={isDisabled || !sandboxId}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Generate with AI
                  </>
                )}
              </Button>
              <Button
                onClick={handleCreate}
                disabled={isDisabled || !title.trim()}
              >
                {isCreating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create PR"
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
