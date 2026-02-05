"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Sparkles,
  ExternalLink,
  Check,
  Loader2,
  GitCommit,
  AlertCircle,
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
import type { Session } from "@/lib/db/schema";

interface CreatePRDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session;
  hasSandbox: boolean;
}

interface GitActions {
  committed?: boolean;
  commitMessage?: string;
  pushed?: boolean;
}

type WizardStep = "create-branch" | "commit" | "generate";

export function CreatePRDialog({
  open,
  onOpenChange,
  session,
  hasSandbox,
}: CreatePRDialogProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const [branches, setBranches] = useState<string[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [result, setResult] = useState<{ prUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gitActions, setGitActions] = useState<GitActions | null>(null);
  const [resolvedBranch, setResolvedBranch] = useState<string | null>(null);
  const [hasUncommittedChanges, setHasUncommittedChanges] = useState(false);
  const [isDetachedHead, setIsDetachedHead] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [step, setStep] = useState<WizardStep>("generate");
  const [isCommitting, setIsCommitting] = useState(false);
  const [uncommittedFileCount, setUncommittedFileCount] = useState(0);
  const [hasGenerated, setHasGenerated] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setTitle("");
      setBody("");
      setResult(null);
      setError(null);
      setGitActions(null);
      setResolvedBranch(null);
      setIsCreatingBranch(false);
      setHasUncommittedChanges(false);
      setIsDetachedHead(false);
      setStep("generate");
      setUncommittedFileCount(0);
      setHasGenerated(false);
    }
  }, [open]);

  // Check git status when dialog opens
  const checkGitStatus = useCallback(async () => {
    if (!hasSandbox) return;
    setIsCheckingStatus(true);
    try {
      const res = await fetch("/api/git-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id }),
      });
      if (res.ok) {
        const data = await res.json();
        setHasUncommittedChanges(data.hasUncommittedChanges ?? false);
        setIsDetachedHead(data.isDetachedHead ?? false);
        setUncommittedFileCount(data.uncommittedFiles ?? 0);
        if (data.branch && data.branch !== "HEAD") {
          setResolvedBranch(data.branch);
        }
      }
    } catch (err) {
      console.error("Failed to check git status:", err);
    } finally {
      setIsCheckingStatus(false);
    }
  }, [hasSandbox, session.id]);

  useEffect(() => {
    if (open && hasSandbox) {
      checkGitStatus();
    }
  }, [open, hasSandbox, checkGitStatus]);

  // Determine which step to show after git status check completes
  const currentBranch = resolvedBranch ?? session.branch ?? baseBranch;
  const displayBranch = currentBranch === "HEAD" ? baseBranch : currentBranch;
  const isOnBaseBranch = displayBranch === baseBranch;
  const needsNewBranch = isOnBaseBranch || isDetachedHead;

  useEffect(() => {
    if (!isCheckingStatus && open) {
      if (needsNewBranch) {
        setStep("create-branch");
      } else if (hasUncommittedChanges) {
        setStep("commit");
      } else {
        setStep("generate");
      }
    }
  }, [isCheckingStatus, open, needsNewBranch, hasUncommittedChanges]);

  const fetchBranches = useCallback(async () => {
    setIsLoadingBranches(true);
    try {
      const res = await fetch(
        `/api/github/branches?owner=${session.repoOwner}&repo=${session.repoName}`,
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
  }, [session.repoOwner, session.repoName]);

  // Fetch branches when dialog opens
  useEffect(() => {
    if (open && session.repoOwner && session.repoName) {
      fetchBranches();
    }
  }, [open, session.repoOwner, session.repoName, fetchBranches]);

  const handleCreateBranch = async () => {
    if (!hasSandbox) {
      setError("Sandbox not active. Please wait for sandbox to start.");
      return;
    }
    setIsCreatingBranch(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          sessionTitle: session.title,
          baseBranch,
          branchName: displayBranch,
          createBranchOnly: true,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create branch");
      }

      if (data.branchName && data.branchName !== "HEAD") {
        setResolvedBranch(data.branchName as string);
        // Branch created successfully, no longer in detached HEAD state
        setIsDetachedHead(false);
        // Advance to next step
        if (hasUncommittedChanges) {
          setStep("commit");
        } else {
          setStep("generate");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create branch");
    } finally {
      setIsCreatingBranch(false);
    }
  };

  const handleCommit = async () => {
    if (!hasSandbox) {
      setError("Sandbox not active. Please wait for sandbox to start.");
      return;
    }
    setIsCommitting(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          sessionTitle: session.title,
          baseBranch,
          branchName: displayBranch,
          commitOnly: true,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to commit changes");
      }

      if (data.gitActions) {
        setGitActions(data.gitActions);
      }
      if (data.branchName && data.branchName !== "HEAD") {
        setResolvedBranch(data.branchName as string);
      }
      // Advance to generate step
      setHasUncommittedChanges(false);
      setStep("generate");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to commit changes");
    } finally {
      setIsCommitting(false);
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          sessionTitle: session.title,
          baseBranch,
          branchName: displayBranch,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to generate PR content");
      }

      setTitle(data.title);
      setBody(data.body);
      setHasGenerated(true);
      if (data.gitActions) {
        setGitActions(data.gitActions);
      }
      if (data.branchName && data.branchName !== "HEAD") {
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
          sessionId: session.id,
          repoUrl: session.cloneUrl,
          branchName: displayBranch,
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

  const isDisabled =
    isGenerating ||
    isCreating ||
    isCreatingBranch ||
    isCheckingStatus ||
    isCommitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Pull Request</DialogTitle>
          <DialogDescription>
            {session.repoOwner}/{session.repoName} - {displayBranch}
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
          // Wizard steps
          <>
            <div className="grid gap-4 py-4">
              {/* Step: Create Branch */}
              {step === "create-branch" && (
                <>
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

                  <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                    <p>
                      {isDetachedHead
                        ? "You're in detached HEAD state. Create a new branch to continue."
                        : "You're on the base branch. Create a new branch to continue."}
                    </p>
                  </div>
                </>
              )}

              {/* Step: Commit Changes */}
              {step === "commit" && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  <AlertCircle className="mt-0.5 h-4 w-4 text-amber-500" />
                  <div>
                    <p className="font-medium text-amber-700 dark:text-amber-400">
                      {uncommittedFileCount > 0
                        ? `${uncommittedFileCount} uncommitted ${uncommittedFileCount === 1 ? "file" : "files"}`
                        : "Uncommitted changes detected"}
                    </p>
                    <p className="text-muted-foreground">
                      Commit your changes before creating a pull request.
                    </p>
                  </div>
                </div>
              )}

              {/* Step: Generate PR */}
              {step === "generate" && (
                <>
                  {/* Git Actions Banner */}
                  {gitActions &&
                    (gitActions.committed || gitActions.pushed) && (
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
                </>
              )}

              {/* Error Alert - shown on all steps */}
              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
            </div>

            <DialogFooter>
              {/* Step: Create Branch - Footer */}
              {step === "create-branch" && (
                <Button
                  onClick={handleCreateBranch}
                  disabled={isDisabled || !hasSandbox}
                >
                  {isCreatingBranch ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating branch...
                    </>
                  ) : isCheckingStatus ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    "Create new branch"
                  )}
                </Button>
              )}

              {/* Step: Commit - Footer */}
              {step === "commit" && (
                <Button
                  onClick={handleCommit}
                  disabled={isDisabled || !hasSandbox}
                >
                  {isCommitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Committing...
                    </>
                  ) : (
                    "Commit changes"
                  )}
                </Button>
              )}

              {/* Step: Generate PR - Footer */}
              {step === "generate" && (
                <>
                  <Button
                    variant="outline"
                    onClick={handleGenerate}
                    disabled={isDisabled || !hasSandbox || hasGenerated}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Generating...
                      </>
                    ) : hasGenerated ? (
                      <>
                        <Check className="mr-2 h-4 w-4" />
                        Generated
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Auto-generate with AI
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
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
