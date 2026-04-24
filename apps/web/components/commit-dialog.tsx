"use client";

import {
  AlertCircle,
  Check,
  ExternalLink,
  GitCommit,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WebAgentUIMessage } from "@/app/types";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { type SessionGitStatus } from "@/hooks/use-session-git-status";
import type { Session } from "@/lib/db/schema";
import {
  commitAndPushSessionChanges,
  createSessionBranch,
  fetchRepoBranches,
  type GitActionsResult,
} from "@/lib/git-flow-client";

interface CommitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session;
  hasSandbox: boolean;
  gitStatus: SessionGitStatus | null;
  refreshGitStatus: () => Promise<SessionGitStatus | undefined>;
  onCommitted?: () => void;
  onGitMessage?: (message: WebAgentUIMessage) => Promise<void> | void;
  onOpenCreatePr?: () => void;
}

type GitActions = GitActionsResult;

type CommitStep = "loading" | "create-branch" | "commit" | "success";
type CommitMode = "ai" | "manual";

export function CommitDialog({
  open,
  onOpenChange,
  session,
  hasSandbox,
  gitStatus,
  refreshGitStatus,
  onCommitted,
  onGitMessage,
  onOpenCreatePr,
}: CommitDialogProps) {
  const [baseBranch, setBaseBranch] = useState("main");
  const [branches, setBranches] = useState<string[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gitActions, setGitActions] = useState<GitActions | null>(null);
  const [resolvedBranch, setResolvedBranch] = useState<string | null>(null);
  const [isDetachedHead, setIsDetachedHead] = useState(false);
  const [step, setStep] = useState<CommitStep>("loading");
  const [mode, setMode] = useState<CommitMode>("ai");
  const [manualTitle, setManualTitle] = useState("");
  const [manualBody, setManualBody] = useState("");
  const [statusSnapshot, setStatusSnapshot] = useState<SessionGitStatus | null>(
    null,
  );
  const statusRequestIdRef = useRef(0);
  const wasOpenRef = useRef(false);

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
      setBranches(["main"]);
    } finally {
      setIsLoadingBranches(false);
    }
  }, [session.repoName, session.repoOwner]);

  const syncGitStatus = useCallback(async () => {
    if (!hasSandbox) {
      setStatusSnapshot(gitStatus);
      setIsDetachedHead(false);
      setIsCheckingStatus(false);
      return;
    }

    const requestId = statusRequestIdRef.current + 1;
    statusRequestIdRef.current = requestId;
    setIsCheckingStatus(true);
    setStep("loading");

    try {
      const latest = await refreshGitStatus();
      if (requestId !== statusRequestIdRef.current) return;

      const nextStatus = latest ?? gitStatus;
      setStatusSnapshot(nextStatus);
      if (nextStatus?.branch && nextStatus.branch !== "HEAD") {
        setResolvedBranch(nextStatus.branch);
      }
      setIsDetachedHead(nextStatus?.isDetachedHead ?? false);
    } catch (err) {
      if (requestId !== statusRequestIdRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to check git status",
      );
    } finally {
      if (requestId === statusRequestIdRef.current) {
        setIsCheckingStatus(false);
      }
    }
  }, [gitStatus, hasSandbox, refreshGitStatus]);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }

    if (wasOpenRef.current) {
      return;
    }

    wasOpenRef.current = true;

    setError(null);
    setGitActions(null);
    setResolvedBranch(null);
    setIsDetachedHead(false);
    setStep("loading");
    setMode("ai");
    setManualTitle("");
    setManualBody("");
    setStatusSnapshot(gitStatus);

    void fetchBranches();
    void syncGitStatus();
  }, [open, fetchBranches, gitStatus, syncGitStatus]);

  const effectiveStatus = statusSnapshot ?? gitStatus;
  const branchFromStatus =
    resolvedBranch ??
    (effectiveStatus?.branch && effectiveStatus.branch !== "HEAD"
      ? effectiveStatus.branch
      : null);
  const currentBranch = branchFromStatus ?? session.branch ?? baseBranch;
  const displayBranch = currentBranch === "HEAD" ? baseBranch : currentBranch;
  const needsNewBranch = displayBranch === baseBranch || isDetachedHead;
  const hasUncommittedChanges = effectiveStatus?.hasUncommittedChanges ?? false;
  const hasUnpushedCommits = effectiveStatus?.hasUnpushedCommits ?? false;
  const stagedCount = effectiveStatus?.stagedCount ?? 0;
  const unstagedCount = effectiveStatus?.unstagedCount ?? 0;
  const untrackedCount = effectiveStatus?.untrackedCount ?? 0;
  const hasPendingGitWork = hasUncommittedChanges || hasUnpushedCommits;

  useEffect(() => {
    if (!open) return;
    if (isCheckingStatus) {
      setStep("loading");
      return;
    }
    if (gitActions?.committed || gitActions?.pushed) {
      setStep("success");
      return;
    }
    if (needsNewBranch) {
      setStep("create-branch");
      return;
    }
    setStep("commit");
  }, [open, isCheckingStatus, gitActions, needsNewBranch]);

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
      }

      setIsDetachedHead(false);
      await syncGitStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create branch");
    } finally {
      setIsCreatingBranch(false);
    }
  };

  const handleSubmit = async () => {
    if (!hasSandbox) {
      setError("Sandbox not active. Please wait for sandbox to start.");
      return;
    }
    if (!hasPendingGitWork) {
      onOpenChange(false);
      return;
    }
    if (mode === "manual" && hasUncommittedChanges && !manualTitle.trim()) {
      setError("Commit title is required when using manual commit mode.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const gitMessageId = crypto.randomUUID();
    const commitPartId = `${gitMessageId}:commit`;

    try {
      await onGitMessage?.({
        id: gitMessageId,
        role: "assistant",
        metadata: {},
        parts: [
          {
            type: "data-commit",
            id: commitPartId,
            data: { status: "pending" },
          },
        ],
      });

      const response = await commitAndPushSessionChanges({
        sessionId: session.id,
        sessionTitle: session.title,
        baseBranch,
        branchName: displayBranch,
        ...(mode === "manual" && hasUncommittedChanges
          ? {
              commitTitle: manualTitle,
              commitBody: manualBody,
            }
          : {}),
      });

      setGitActions(response.gitActions ?? null);

      if (response.branchName && response.branchName !== "HEAD") {
        setResolvedBranch(response.branchName);
      }

      const commitUrl =
        response.gitActions?.commitSha && session.repoOwner && session.repoName
          ? `https://github.com/${session.repoOwner}/${session.repoName}/commit/${response.gitActions.commitSha}`
          : undefined;

      await onGitMessage?.({
        id: gitMessageId,
        role: "assistant",
        metadata: {},
        parts: [
          {
            type: "data-commit",
            id: commitPartId,
            data: {
              status: "success",
              committed: response.gitActions?.committed,
              pushed: response.gitActions?.pushed,
              commitMessage: response.gitActions?.commitMessage,
              commitSha: response.gitActions?.commitSha,
              url: commitUrl,
            },
          },
        ],
      });

      await syncGitStatus();
      setStep("success");
      onCommitted?.();
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Failed to commit and push changes";

      await onGitMessage?.({
        id: gitMessageId,
        role: "assistant",
        metadata: {},
        parts: [
          {
            type: "data-commit",
            id: commitPartId,
            data: {
              status: "error",
              error: errorMessage,
            },
          },
        ],
      });

      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const shouldEmphasizePush = Boolean(session.prNumber) || hasUnpushedCommits;
  const submitLabel = hasUncommittedChanges
    ? shouldEmphasizePush
      ? "Commit & Push"
      : "Commit changes"
    : "Push commits";
  const isDisabled = isCheckingStatus || isCreatingBranch || isSubmitting;

  const commitUrl =
    gitActions?.commitSha && session.repoOwner && session.repoName
      ? `https://github.com/${session.repoOwner}/${session.repoName}/commit/${gitActions.commitSha}`
      : null;
  const prUrl =
    session.prNumber && session.repoOwner && session.repoName
      ? `https://github.com/${session.repoOwner}/${session.repoName}/pull/${session.prNumber}`
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Commit Changes</DialogTitle>
          <DialogDescription>
            {session.repoOwner}/{session.repoName} - {displayBranch}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {step === "loading" && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking current git changes...
            </div>
          )}

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
                {isDetachedHead
                  ? "You are in detached HEAD state. Create a branch before committing."
                  : "You are on the base branch. Create a new branch before committing."}
              </div>
            </>
          )}

          {step === "commit" && (
            <>
              <div
                className={
                  hasPendingGitWork
                    ? "flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
                    : "flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm"
                }
              >
                <AlertCircle
                  className={
                    hasPendingGitWork
                      ? "mt-0.5 h-4 w-4 text-amber-500"
                      : "mt-0.5 h-4 w-4 text-muted-foreground"
                  }
                />
                <div className="space-y-1">
                  <p
                    className={
                      hasPendingGitWork
                        ? "font-medium text-amber-700 dark:text-amber-400"
                        : "font-medium text-foreground"
                    }
                  >
                    {hasPendingGitWork
                      ? hasUncommittedChanges
                        ? "Uncommitted changes detected"
                        : "Unpushed commits detected"
                      : "No pending git changes"}
                  </p>
                  <p className="text-muted-foreground">
                    {`Unstaged: ${unstagedCount}, staged: ${stagedCount}, untracked: ${untrackedCount}`}
                  </p>
                </div>
              </div>

              {hasUncommittedChanges && (
                <Tabs
                  value={mode}
                  onValueChange={(value) =>
                    setMode(value === "manual" ? "manual" : "ai")
                  }
                  className="gap-3"
                >
                  <div className="grid gap-2">
                    <Label>Commit mode</Label>
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="ai">
                        <Sparkles className="h-4 w-4" />
                        AI message
                      </TabsTrigger>
                      <TabsTrigger value="manual">
                        <GitCommit className="h-4 w-4" />
                        Manual message
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  <TabsContent value="ai" className="mt-0">
                    <p className="text-sm text-muted-foreground">
                      AI will generate a concise commit message from staged
                      changes.
                    </p>
                  </TabsContent>

                  <TabsContent value="manual" className="mt-0 grid gap-3">
                    <div className="grid gap-2">
                      <Label htmlFor="commit-title">Commit title</Label>
                      <Input
                        id="commit-title"
                        placeholder="feat: add git panel improvements"
                        value={manualTitle}
                        onChange={(e) => setManualTitle(e.target.value)}
                        disabled={isDisabled}
                        maxLength={72}
                      />
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="commit-body">Commit description</Label>
                      <Textarea
                        id="commit-body"
                        placeholder="Optional details for commit body"
                        value={manualBody}
                        onChange={(e) => setManualBody(e.target.value)}
                        disabled={isDisabled}
                        rows={4}
                        className="resize-y max-h-48 overflow-y-auto field-sizing-fixed"
                      />
                    </div>
                  </TabsContent>
                </Tabs>
              )}
            </>
          )}

          {step === "success" && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
                <Check className="h-6 w-6 text-green-500" />
              </div>

              <div className="space-y-2 text-center text-sm">
                <p className="font-medium">Git changes updated successfully.</p>

                {gitActions?.committed && gitActions.commitMessage && (
                  <p>
                    <span className="font-medium">Committed:</span>{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">
                      {gitActions.commitMessage}
                    </code>
                  </p>
                )}

                {gitActions?.pushed && (
                  <p className="text-muted-foreground">Pushed to origin</p>
                )}

                {commitUrl && (
                  /* oxlint-disable-next-line nextjs/no-html-link-for-pages */
                  <a
                    href={commitUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-blue-500 hover:underline"
                  >
                    View commit
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
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
              ) : (
                "Create new branch"
              )}
            </Button>
          )}

          {step === "commit" && (
            <>
              {!hasPendingGitWork ? (
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={isDisabled || !hasSandbox}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {hasUncommittedChanges ? "Committing..." : "Pushing..."}
                    </>
                  ) : (
                    submitLabel
                  )}
                </Button>
              )}
            </>
          )}

          {step === "success" && (
            <>
              {!session.prNumber && onOpenCreatePr && (
                <Button
                  onClick={() => {
                    onOpenChange(false);
                    onOpenCreatePr();
                  }}
                >
                  Create PR
                </Button>
              )}

              {session.prNumber && prUrl && (
                <Button
                  onClick={() => {
                    window.open(prUrl, "_blank", "noopener,noreferrer");
                  }}
                >
                  View PR
                </Button>
              )}

              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
