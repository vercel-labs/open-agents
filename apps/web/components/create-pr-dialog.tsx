"use client";

import {
  Check,
  ChevronDown,
  ExternalLink,
  GitCommit,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import type { Session } from "@/lib/db/schema";
import {
  createSessionBranch,
  fetchRepoBranches,
  generatePullRequestContent,
  type GitActionsResult,
} from "@/lib/git-flow-client";

interface CreatePRDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session;
  hasSandbox: boolean;
  onPrDetected?: (info: {
    prNumber: number;
    prStatus: "open" | "merged" | "closed";
  }) => void;
}

type GitActions = GitActionsResult;

type WizardStep = "create-branch" | "generate";
type PrCreationMode = "ready" | "draft";

function buildCompareUrl(params: {
  owner: string;
  repo: string;
  baseBranch: string;
  headRef: string;
  title?: string;
  body?: string;
}): string {
  const { owner, repo, baseBranch, headRef, title, body } = params;
  const compareUrl = new URL(
    `https://github.com/${owner}/${repo}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(headRef)}`,
  );
  compareUrl.searchParams.set("expand", "1");

  const trimmedTitle = title?.trim();
  if (trimmedTitle) {
    compareUrl.searchParams.set("title", trimmedTitle);
  }

  const trimmedBody = body?.trim();
  if (trimmedBody) {
    compareUrl.searchParams.set("body", trimmedBody);
  }

  return compareUrl.toString();
}

export function CreatePRDialog({
  open,
  onOpenChange,
  session,
  hasSandbox,
  onPrDetected,
}: CreatePRDialogProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const [branches, setBranches] = useState<string[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [result, setResult] = useState<{
    prUrl: string;
    requiresManualCreation?: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gitActions, setGitActions] = useState<GitActions | null>(null);
  const [resolvedBranch, setResolvedBranch] = useState<string | null>(null);
  const [hasUncommittedChanges, setHasUncommittedChanges] = useState(false);
  const [isDetachedHead, setIsDetachedHead] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [step, setStep] = useState<WizardStep>("generate");
  const [hasGenerated, setHasGenerated] = useState(false);
  const [prHeadOwner, setPrHeadOwner] = useState<string | null>(null);
  const [prCreationMode, setPrCreationMode] = useState<PrCreationMode>("ready");
  const isDraft = prCreationMode === "draft";

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
      setHasGenerated(false);
      setPrHeadOwner(null);
      setPrCreationMode("ready");
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
  const normalizedRepoOwner = session.repoOwner?.toLowerCase() ?? null;
  const normalizedHeadOwner = prHeadOwner?.toLowerCase() ?? null;
  const shouldOpenCompareInsteadOfApi = Boolean(
    gitActions?.pushedToFork ||
    (normalizedRepoOwner &&
      normalizedHeadOwner &&
      normalizedHeadOwner !== normalizedRepoOwner),
  );

  useEffect(() => {
    if (!isCheckingStatus && open) {
      if (needsNewBranch) {
        setStep("create-branch");
      } else {
        setStep("generate");
      }
    }
  }, [isCheckingStatus, open, needsNewBranch]);

  const fetchBranches = useCallback(async () => {
    if (!session.repoOwner || !session.repoName) return;
    setIsLoadingBranches(true);
    try {
      const branchData = await fetchRepoBranches(
        session.repoOwner,
        session.repoName,
      );
      setBranches(branchData.branches);
      setBaseBranch(branchData.defaultBranch);
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
      const result = await createSessionBranch({
        sessionId: session.id,
        sessionTitle: session.title,
        baseBranch,
        branchName: displayBranch,
      });

      if (result.branchName !== "HEAD") {
        setResolvedBranch(result.branchName);
        // Branch created successfully, no longer in detached HEAD state
        setIsDetachedHead(false);
        // Advance to PR generation step
        setStep("generate");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create branch");
    } finally {
      setIsCreatingBranch(false);
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const data = await generatePullRequestContent({
        sessionId: session.id,
        sessionTitle: session.title,
        baseBranch,
        branchName: displayBranch,
      });

      setTitle(data.title ?? "");
      setBody(data.body ?? "");
      setHasGenerated(true);
      if (data.gitActions) {
        setGitActions(data.gitActions);
      }
      if (typeof data.prHeadOwner === "string" && data.prHeadOwner.length > 0) {
        setPrHeadOwner(data.prHeadOwner);
      }
      if (data.branchName && data.branchName !== "HEAD") {
        setResolvedBranch(data.branchName);
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
      if (
        shouldOpenCompareInsteadOfApi &&
        session.repoOwner &&
        session.repoName
      ) {
        const headOwner = prHeadOwner?.trim() || session.repoOwner;
        const sameOwner =
          headOwner.toLowerCase() === session.repoOwner.toLowerCase();
        const headRef = sameOwner
          ? displayBranch
          : `${headOwner}:${displayBranch}`;
        const compareUrl = buildCompareUrl({
          owner: session.repoOwner,
          repo: session.repoName,
          baseBranch,
          headRef,
          title,
          body,
        });

        window.open(compareUrl, "_blank", "noopener,noreferrer");
        setResult({ prUrl: compareUrl, requiresManualCreation: true });
        return;
      }

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
          headOwner: prHeadOwner ?? undefined,
          isDraft,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create PR");
      }

      setResult({
        prUrl: data.prUrl,
        requiresManualCreation: Boolean(data.requiresManualCreation),
      });

      if (typeof data.prNumber === "number") {
        onPrDetected?.({
          prNumber: data.prNumber,
          prStatus:
            data.prStatus === "merged" || data.prStatus === "closed"
              ? data.prStatus
              : "open",
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create PR");
    } finally {
      setIsCreating(false);
    }
  };

  const isDisabled =
    isGenerating || isCreating || isCreatingBranch || isCheckingStatus;

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
              <p className="font-medium">
                {result.requiresManualCreation
                  ? isDraft
                    ? "Open GitHub to create the draft pull request"
                    : "Open GitHub to create the pull request"
                  : isDraft
                    ? "Draft pull request created successfully!"
                    : "Pull request created successfully!"}
              </p>
              {/* External link to GitHub - not internal navigation */}
              {/* oxlint-disable-next-line nextjs/no-html-link-for-pages */}
              <a
                href={result.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-sm text-blue-500 hover:underline"
              >
                {result.requiresManualCreation
                  ? "Open compare page"
                  : "View on GitHub"}
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

              {/* Step: Generate PR */}
              {step === "generate" && (
                <>
                  {hasUncommittedChanges && (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                      Commit your changes before creating a pull request.
                    </div>
                  )}

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
                              {gitActions.pushedToFork && prHeadOwner
                                ? `Branch pushed to fork ${prHeadOwner}`
                                : "Branch pushed to origin"}
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                  {shouldOpenCompareInsteadOfApi && (
                    <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-800 dark:text-blue-300">
                      We pushed your branch, but this repository does not allow
                      API-based PR creation for the current app token. Open
                      GitHub to create the PR from the compare page.
                      {isDraft && (
                        <p className="mt-2">
                          GitHub will still open the standard compare flow.
                          Choose
                          <span className="font-medium">
                            {" "}
                            Create draft pull request
                          </span>
                          on GitHub to keep it in draft mode.
                        </p>
                      )}
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
                      className="resize-y max-h-48 overflow-y-auto field-sizing-fixed"
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

              {/* Step: Generate PR - Footer */}
              {step === "generate" && (
                <>
                  <Button
                    variant="outline"
                    onClick={handleGenerate}
                    disabled={
                      isDisabled ||
                      !hasSandbox ||
                      hasGenerated ||
                      hasUncommittedChanges
                    }
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
                  <div className="flex">
                    <Button
                      onClick={handleCreate}
                      className="rounded-r-none"
                      disabled={
                        isDisabled || !title.trim() || hasUncommittedChanges
                      }
                    >
                      {isCreating ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Creating...
                        </>
                      ) : shouldOpenCompareInsteadOfApi ? (
                        isDraft ? (
                          "Open Compare for Draft"
                        ) : (
                          "Open Compare Page"
                        )
                      ) : isDraft ? (
                        "Create Draft PR"
                      ) : (
                        "Create PR"
                      )}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="default"
                          size="icon"
                          className="rounded-l-none border-l border-l-primary-foreground/25"
                          disabled={
                            isDisabled || !title.trim() || hasUncommittedChanges
                          }
                          aria-label="Choose pull request type"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-72">
                        <DropdownMenuItem
                          className="items-start gap-3 py-2"
                          onSelect={() => setPrCreationMode("ready")}
                        >
                          <Check
                            className={
                              prCreationMode === "ready"
                                ? "mt-0.5 h-4 w-4"
                                : "mt-0.5 h-4 w-4 opacity-0"
                            }
                          />
                          <div className="flex flex-col">
                            <span className="font-medium">
                              Create pull request
                            </span>
                            <span className="text-muted-foreground text-xs">
                              Open a pull request that is ready for review
                            </span>
                          </div>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="items-start gap-3 py-2"
                          onSelect={() => setPrCreationMode("draft")}
                        >
                          <Check
                            className={
                              prCreationMode === "draft"
                                ? "mt-0.5 h-4 w-4"
                                : "mt-0.5 h-4 w-4 opacity-0"
                            }
                          />
                          <div className="flex flex-col">
                            <span className="font-medium">
                              Create draft pull request
                            </span>
                            <span className="text-muted-foreground text-xs">
                              Cannot be merged until marked ready for review
                            </span>
                          </div>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
