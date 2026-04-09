"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitCommit,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  Loader2,
  SquareDot,
  SquareMinus,
  SquarePlus,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DiffFile } from "@/app/api/sessions/[sessionId]/diff/route";
import type { MergeReadinessResponse } from "@/app/api/sessions/[sessionId]/merge-readiness/route";
import type { MergePullRequestResponse } from "@/app/api/sessions/[sessionId]/merge/route";
import type { Session } from "@/lib/db/schema";
import type {
  PullRequestCheckRun,
  PullRequestMergeMethod,
} from "@/lib/github/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CheckRunsList } from "@/components/merge-check-runs";
import { cn } from "@/lib/utils";
import {
  commitAndPushSessionChanges,
  createSessionBranch,
  fetchRepoBranches,
  generatePullRequestContent,
} from "@/lib/git-flow-client";
import type { SessionGitStatus } from "@/hooks/use-session-git-status";
import { useGitPanel } from "./git-panel-context";

/* ------------------------------------------------------------------ */
/* Merge method labels / descriptions                                  */
/* ------------------------------------------------------------------ */

const mergeMethodLabels: Record<PullRequestMergeMethod, string> = {
  squash: "Squash and merge",
  merge: "Create a merge commit",
  rebase: "Rebase and merge",
};

const mergeMethodButtonLabels: Record<PullRequestMergeMethod, string> = {
  squash: "Squash & Archive",
  merge: "Merge & Archive",
  rebase: "Rebase & Archive",
};

const mergeMethodDescriptions: Record<PullRequestMergeMethod, string> = {
  squash: "Combine all commits into one commit in the base branch.",
  merge: "All commits will be added to the base branch via a merge commit.",
  rebase: "All commits will be rebased and added to the base branch.",
};

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type GitPanelProps = {
  session: Session;
  // Git state
  hasRepo: boolean;
  hasExistingPr: boolean;
  existingPrUrl: string | null;
  prDeploymentUrl: string | null;
  buildingDeploymentUrl: string | null;
  isDeploymentStale: boolean;
  hasUncommittedGitChanges: boolean;
  supportsRepoCreation: boolean;
  hasDiff: boolean;

  // Diff data
  diffFiles: DiffFile[] | null;
  diffSummary?: {
    totalAdditions: number;
    totalDeletions: number;
  } | null;

  // Actions
  onCreateRepoClick: () => void;

  // Merge
  onMerged: (result: MergePullRequestResponse) => Promise<void> | void;
  onFixChecks?: (failedRuns: PullRequestCheckRun[]) => Promise<void> | void;

  // For inline commit
  hasSandbox: boolean;
  gitStatus: SessionGitStatus | null;
  refreshGitStatus: () => Promise<SessionGitStatus | undefined>;
  onCommitted?: () => void;
  isAgentWorking: boolean;

  // For inline PR creation
  onPrDetected?: (info: {
    prNumber: number;
    prStatus: "open" | "merged" | "closed";
  }) => void;
};

/* ------------------------------------------------------------------ */
/* Diff file list for the panel's Diff tab                             */
/* ------------------------------------------------------------------ */

function DiffFileStatusIcon({ status }: { status: DiffFile["status"] }) {
  if (status === "added") {
    return <SquarePlus className="h-4 w-4 shrink-0 text-green-500" />;
  }
  if (status === "deleted") {
    return <SquareMinus className="h-4 w-4 shrink-0 text-red-500" />;
  }
  if (status === "renamed") {
    return <SquareDot className="h-4 w-4 shrink-0 text-yellow-500" />;
  }
  // modified
  return <SquareDot className="h-4 w-4 shrink-0 text-yellow-500" />;
}

function isUncommittedFile(file: DiffFile): boolean {
  return file.stagingStatus === "unstaged" || file.stagingStatus === "partial";
}

function DiffFileList({ files }: { files: DiffFile[] }) {
  const { openDiffToFile, diffScope } = useGitPanel();

  const filteredFiles =
    diffScope === "branch" ? files : files.filter(isUncommittedFile);

  if (filteredFiles.length === 0) {
    return (
      <div className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/25 py-8 text-center">
        <p className="text-xs text-muted-foreground">
          {diffScope === "uncommitted"
            ? "No uncommitted changes"
            : "No file changes yet"}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="space-y-px">
        {filteredFiles.map((file) => {
          const fileName = file.path.split("/").pop() ?? file.path;
          const dirPath = file.path.slice(0, -fileName.length);

          return (
            <button
              key={file.path}
              type="button"
              onClick={() => openDiffToFile(file.path)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
            >
              <DiffFileStatusIcon status={file.status} />
              <div className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
                <span className="shrink-0 text-xs font-medium text-foreground font-mono">
                  {fileName}
                </span>
                {dirPath && (
                  <span
                    className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-muted-foreground"
                    dir="rtl"
                  >
                    <bdi>{dirPath.replace(/\/$/, "")}</bdi>
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5 text-[10px]">
                {file.additions > 0 && (
                  <span className="text-green-600 dark:text-green-500">
                    +{file.additions}
                  </span>
                )}
                {file.deletions > 0 && (
                  <span className="text-red-600 dark:text-red-400">
                    -{file.deletions}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inline commit panel (replaces the commit dialog)                    */
/* ------------------------------------------------------------------ */

function InlineCommitPanel({
  session,
  hasSandbox,
  gitStatus,
  refreshGitStatus,
  onCommitted,
  isAgentWorking,
}: {
  session: Session;
  hasSandbox: boolean;
  gitStatus: SessionGitStatus | null;
  refreshGitStatus: () => Promise<SessionGitStatus | undefined>;
  onCommitted?: () => void;
  isAgentWorking: boolean;
}) {
  const [commitTitle, setCommitTitle] = useState("");
  const [commitBody, setCommitBody] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitSuccess, setCommitSuccess] = useState<{
    commitSha?: string;
    commitMessage?: string;
  } | null>(null);
  const [baseBranch, setBaseBranch] = useState("main");
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [resolvedBranch, setResolvedBranch] = useState<string | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasUncommittedChanges = gitStatus?.hasUncommittedChanges ?? false;
  const hasUnpushedCommits = gitStatus?.hasUnpushedCommits ?? false;
  const hasPendingGitWork = hasUncommittedChanges || hasUnpushedCommits;

  const branchFromStatus =
    resolvedBranch ??
    (gitStatus?.branch && gitStatus.branch !== "HEAD"
      ? gitStatus.branch
      : null);
  const currentBranch = branchFromStatus ?? session.branch ?? baseBranch;
  const displayBranch = currentBranch === "HEAD" ? baseBranch : currentBranch;
  const isDetachedHead = gitStatus?.isDetachedHead ?? false;
  const needsNewBranch = displayBranch === baseBranch || isDetachedHead;

  // Fetch branches on mount
  useEffect(() => {
    if (!session.repoOwner || !session.repoName) return;
    void fetchRepoBranches(session.repoOwner, session.repoName)
      .then((data) => {
        setBaseBranch(data.defaultBranch);
      })
      .catch(() => {});
  }, [session.repoOwner, session.repoName]);

  // Cleanup timeout
  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  const handleCreateBranch = async () => {
    if (!hasSandbox) return;
    setIsCreatingBranch(true);
    setCommitError(null);
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
      await refreshGitStatus();
    } catch (err) {
      setCommitError(
        err instanceof Error ? err.message : "Failed to create branch",
      );
    } finally {
      setIsCreatingBranch(false);
    }
  };

  const handleCommit = async () => {
    if (!hasSandbox || !hasPendingGitWork) return;
    setIsCommitting(true);
    setCommitError(null);
    setCommitSuccess(null);

    try {
      const response = await commitAndPushSessionChanges({
        sessionId: session.id,
        sessionTitle: session.title,
        baseBranch,
        branchName: displayBranch,
        ...(commitTitle.trim()
          ? { commitTitle: commitTitle.trim(), commitBody: commitBody.trim() }
          : {}),
      });

      if (response.branchName && response.branchName !== "HEAD") {
        setResolvedBranch(response.branchName);
      }

      setCommitSuccess({
        commitSha: response.gitActions?.commitSha,
        commitMessage: response.gitActions?.commitMessage,
      });
      setCommitTitle("");
      setCommitBody("");

      onCommitted?.();

      // Clear success after 3 seconds
      successTimeoutRef.current = setTimeout(() => {
        setCommitSuccess(null);
      }, 3000);
    } catch (err) {
      setCommitError(
        err instanceof Error ? err.message : "Failed to commit and push",
      );
    } finally {
      setIsCommitting(false);
    }
  };

  // Needs branch creation
  if (needsNewBranch) {
    return (
      <div className="space-y-2">
        <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          {isDetachedHead
            ? "Detached HEAD — create a branch first."
            : "On base branch — create a new branch first."}
        </div>
        <Button
          size="sm"
          className="w-full text-xs"
          onClick={() => void handleCreateBranch()}
          disabled={isAgentWorking || isCreatingBranch || !hasSandbox}
        >
          {isCreatingBranch ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Creating branch...
            </>
          ) : (
            <>
              <GitBranch className="mr-1.5 h-3.5 w-3.5" />
              Create branch
            </>
          )}
        </Button>
        {isAgentWorking && (
          <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
            Wait for the agent to finish before creating a branch.
          </div>
        )}
        {commitError && (
          <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            {commitError}
          </div>
        )}
      </div>
    );
  }

  // Success state
  if (commitSuccess) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 p-2 text-xs text-green-700 dark:text-green-300">
        <Check className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          {commitSuccess.commitMessage ?? "Changes committed & pushed"}
        </span>
      </div>
    );
  }

  // Commit form
  return (
    <div className="space-y-2">
      <Input
        placeholder="Commit message (optional)"
        value={commitTitle}
        onChange={(e) => setCommitTitle(e.target.value)}
        disabled={isAgentWorking || isCommitting || !hasPendingGitWork}
        className="h-8 text-xs"
      />
      <Textarea
        placeholder="Description (optional)"
        value={commitBody}
        onChange={(e) => setCommitBody(e.target.value)}
        disabled={isAgentWorking || isCommitting || !hasPendingGitWork}
        rows={3}
        className="resize-none text-xs field-sizing-fixed"
      />
      <Button
        size="sm"
        className="w-full text-xs"
        onClick={() => void handleCommit()}
        disabled={
          isAgentWorking || isCommitting || !hasSandbox || !hasPendingGitWork
        }
      >
        {isCommitting ? (
          <>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            Committing...
          </>
        ) : (
          <>
            <GitCommit className="mr-1.5 h-3.5 w-3.5" />
            Commit & Push
          </>
        )}
      </Button>
      {isAgentWorking && (
        <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          Wait for the agent to finish before committing or pushing.
        </div>
      )}
      {commitError && (
        <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          {commitError}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inline PR creation panel                                            */
/* ------------------------------------------------------------------ */

function InlinePrCreatePanel({
  session,
  hasSandbox,
  gitStatus,
  refreshGitStatus,
  hasUncommittedGitChanges,
  onPrDetected,
  isAgentWorking,
}: {
  session: Session;
  hasSandbox: boolean;
  gitStatus: SessionGitStatus | null;
  refreshGitStatus: () => Promise<SessionGitStatus | undefined>;
  hasUncommittedGitChanges: boolean;
  onPrDetected?: (info: {
    prNumber: number;
    prStatus: "open" | "merged" | "closed";
  }) => void;
  isAgentWorking: boolean;
}) {
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [isCreatingPr, setIsCreatingPr] = useState(false);
  const [prError, setPrError] = useState<string | null>(null);
  const [prSuccess, setPrSuccess] = useState<{
    prUrl: string;
    requiresManualCreation?: boolean;
  } | null>(null);
  const [baseBranch, setBaseBranch] = useState("main");
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [resolvedBranch, setResolvedBranch] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [prHeadOwner, setPrHeadOwner] = useState<string | null>(null);

  const branchFromStatus =
    resolvedBranch ??
    (gitStatus?.branch && gitStatus.branch !== "HEAD"
      ? gitStatus.branch
      : null);
  const currentBranch = branchFromStatus ?? session.branch ?? baseBranch;
  const displayBranch = currentBranch === "HEAD" ? baseBranch : currentBranch;
  const isDetachedHead = gitStatus?.isDetachedHead ?? false;
  const needsNewBranch = displayBranch === baseBranch || isDetachedHead;

  // Fetch branches on mount
  useEffect(() => {
    if (!session.repoOwner || !session.repoName) return;
    void fetchRepoBranches(session.repoOwner, session.repoName)
      .then((data) => {
        setBaseBranch(data.defaultBranch);
      })
      .catch(() => {});
  }, [session.repoOwner, session.repoName]);

  const handleCreateBranch = async () => {
    if (!hasSandbox) return;
    setIsCreatingBranch(true);
    setPrError(null);
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
      await refreshGitStatus();
    } catch (err) {
      setPrError(
        err instanceof Error ? err.message : "Failed to create branch",
      );
    } finally {
      setIsCreatingBranch(false);
    }
  };

  const handleCreatePr = async () => {
    setIsCreatingPr(true);
    setPrError(null);

    try {
      let finalTitle = prTitle.trim();
      let finalBody = prBody.trim();

      // Auto-generate if title is empty
      if (!finalTitle) {
        setIsGenerating(true);
        try {
          const generated = await generatePullRequestContent({
            sessionId: session.id,
            sessionTitle: session.title,
            baseBranch,
            branchName: displayBranch,
          });
          finalTitle = generated.title ?? session.title;
          finalBody = finalBody || (generated.body ?? "");
          if (generated.prHeadOwner) {
            setPrHeadOwner(generated.prHeadOwner);
          }
          if (generated.branchName && generated.branchName !== "HEAD") {
            setResolvedBranch(generated.branchName);
          }
        } finally {
          setIsGenerating(false);
        }
      }

      // Check if we need to open compare page instead
      const headOwner = prHeadOwner?.trim() || session.repoOwner;
      const ownerMismatch =
        headOwner &&
        session.repoOwner &&
        headOwner.toLowerCase() !== session.repoOwner.toLowerCase();

      if (ownerMismatch && session.repoOwner && session.repoName) {
        const headRef = `${headOwner}:${displayBranch}`;
        const compareUrl = new URL(
          `https://github.com/${session.repoOwner}/${session.repoName}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(headRef)}`,
        );
        compareUrl.searchParams.set("expand", "1");
        if (finalTitle) compareUrl.searchParams.set("title", finalTitle);
        if (finalBody) compareUrl.searchParams.set("body", finalBody);
        window.open(compareUrl.toString(), "_blank", "noopener,noreferrer");
        setPrSuccess({
          prUrl: compareUrl.toString(),
          requiresManualCreation: true,
        });
        return;
      }

      const res = await fetch("/api/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          repoUrl: session.cloneUrl,
          branchName: displayBranch,
          title: finalTitle,
          body: finalBody,
          baseBranch,
          headOwner: prHeadOwner ?? undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create PR");
      }

      setPrSuccess({
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
      setPrError(err instanceof Error ? err.message : "Failed to create PR");
    } finally {
      setIsCreatingPr(false);
    }
  };

  // Success state
  if (prSuccess) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 p-2 text-xs text-green-700 dark:text-green-300">
          <Check className="h-3.5 w-3.5 shrink-0" />
          <span>
            {prSuccess.requiresManualCreation
              ? "Compare page opened"
              : "Pull request created!"}
          </span>
        </div>
        {/* oxlint-disable-next-line nextjs/no-html-link-for-pages */}
        <a
          href={prSuccess.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-blue-500 hover:underline"
        >
          {prSuccess.requiresManualCreation
            ? "Open compare page"
            : "View on GitHub"}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    );
  }

  // Needs branch creation
  if (needsNewBranch) {
    return (
      <div className="space-y-2">
        <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          {isDetachedHead
            ? "Detached HEAD — create a branch first."
            : "On base branch — create a new branch first."}
        </div>
        <Button
          size="sm"
          className="w-full text-xs"
          onClick={() => void handleCreateBranch()}
          disabled={isAgentWorking || isCreatingBranch || !hasSandbox}
        >
          {isCreatingBranch ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Creating branch...
            </>
          ) : (
            <>
              <GitBranch className="mr-1.5 h-3.5 w-3.5" />
              Create branch
            </>
          )}
        </Button>
        {isAgentWorking && (
          <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
            Wait for the agent to finish before creating a branch.
          </div>
        )}
        {prError && (
          <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            {prError}
          </div>
        )}
      </div>
    );
  }

  // Uncommitted changes warning
  if (hasUncommittedGitChanges) {
    return (
      <div className="px-2 py-3 text-center text-xs text-muted-foreground">
        Commit your changes before creating a pull request.
      </div>
    );
  }

  // PR creation form
  return (
    <div className="space-y-2">
      <Input
        placeholder="PR title (optional)"
        value={prTitle}
        onChange={(e) => setPrTitle(e.target.value)}
        disabled={isAgentWorking || isCreatingPr}
        className="h-8 text-xs"
      />
      <Textarea
        placeholder="Description (optional)"
        value={prBody}
        onChange={(e) => setPrBody(e.target.value)}
        disabled={isAgentWorking || isCreatingPr}
        rows={3}
        className="resize-none text-xs field-sizing-fixed"
      />
      <Button
        size="sm"
        className="w-full text-xs"
        onClick={() => void handleCreatePr()}
        disabled={isAgentWorking || isCreatingPr || !hasSandbox}
      >
        {isCreatingPr ? (
          <>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            {isGenerating ? "Generating..." : "Creating..."}
          </>
        ) : (
          <>
            <GitPullRequest className="mr-1.5 h-3.5 w-3.5" />
            Create Pull Request
          </>
        )}
      </Button>
      {isAgentWorking && (
        <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          Wait for the agent to finish before creating a pull request.
        </div>
      )}
      {prError && (
        <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          {prError}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inline merge UI (replaces the modal dialog)                         */
/* ------------------------------------------------------------------ */

function InlineMergePanel({
  session,
  onMerged,
  onFixChecks,
}: {
  session: Session;
  onMerged: (result: MergePullRequestResponse) => Promise<void> | void;
  onFixChecks?: (failedRuns: PullRequestCheckRun[]) => Promise<void> | void;
}) {
  const [readiness, setReadiness] = useState<MergeReadinessResponse | null>(
    null,
  );
  const [mergeMethod, setMergeMethod] =
    useState<PullRequestMergeMethod>("squash");
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [isLoadingReadiness, setIsLoadingReadiness] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forceConfirming, setForceConfirming] = useState(false);

  const readinessRequestIdRef = useRef(0);
  const forceConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const hasLoadedRef = useRef(false);

  const loadReadiness = useCallback(async () => {
    const requestId = readinessRequestIdRef.current + 1;
    readinessRequestIdRef.current = requestId;

    setIsLoadingReadiness(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/sessions/${session.id}/merge-readiness`,
      );

      const payload = (await response.json()) as
        | MergeReadinessResponse
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : "Failed to load merge readiness",
        );
      }

      if (readinessRequestIdRef.current !== requestId) {
        return;
      }

      const readinessPayload = payload as MergeReadinessResponse;
      setReadiness(readinessPayload);
      setMergeMethod(readinessPayload.defaultMethod);
    } catch (loadError) {
      if (readinessRequestIdRef.current !== requestId) {
        return;
      }

      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load merge readiness",
      );
    } finally {
      if (readinessRequestIdRef.current === requestId) {
        setIsLoadingReadiness(false);
      }
    }
  }, [session.id]);

  // Load readiness on mount
  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      void loadReadiness();
    }
  }, [loadReadiness]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (forceConfirmTimeoutRef.current) {
        clearTimeout(forceConfirmTimeoutRef.current);
      }
    };
  }, []);

  const canMerge = readiness?.canMerge ?? false;

  const handleMerge = async (force = false) => {
    if (!readiness?.pr) {
      setError("No pull request found for this session.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/sessions/${session.id}/merge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          mergeMethod,
          deleteBranch,
          expectedHeadSha: readiness.pr.headSha,
          ...(force ? { force: true } : {}),
        }),
      });

      const payload = (await response.json()) as
        | MergePullRequestResponse
        | { error?: string; reasons?: string[] };

      if (!response.ok) {
        const reasonsText =
          "reasons" in payload && Array.isArray(payload.reasons)
            ? payload.reasons.filter((reason) => typeof reason === "string")
            : [];

        const fallback =
          reasonsText.length > 0
            ? reasonsText.join(". ")
            : "Failed to merge pull request";

        throw new Error(
          "error" in payload && payload.error ? payload.error : fallback,
        );
      }

      const mergeResult = payload as MergePullRequestResponse;
      if (mergeResult.merged !== true) {
        throw new Error("Failed to merge pull request");
      }

      await onMerged(mergeResult);
    } catch (mergeError) {
      setError(
        mergeError instanceof Error
          ? mergeError.message
          : "Failed to merge pull request",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const canForce =
    readiness !== null &&
    !readiness.canMerge &&
    readiness.pr !== null &&
    !isLoadingReadiness;

  const handleForceClick = () => {
    if (forceConfirming) {
      if (forceConfirmTimeoutRef.current) {
        clearTimeout(forceConfirmTimeoutRef.current);
        forceConfirmTimeoutRef.current = null;
      }
      setForceConfirming(false);
      void handleMerge(true);
    } else {
      setForceConfirming(true);
      forceConfirmTimeoutRef.current = setTimeout(() => {
        setForceConfirming(false);
        forceConfirmTimeoutRef.current = null;
      }, 5000);
    }
  };

  const allowedMethods = readiness?.allowedMethods ?? ["squash"];
  const hasMultipleMethods = allowedMethods.length > 1;
  const mergeDisabled =
    isSubmitting || isLoadingReadiness || !readiness || !readiness.pr;

  const prTitle = readiness?.pr?.title ?? null;
  const prBody = readiness?.pr?.body ?? null;

  return (
    <div className="space-y-3">
      {/* PR title & description */}
      {prTitle && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground leading-snug">
            {prTitle}
          </p>
          {prBody && (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4 whitespace-pre-line">
              {prBody}
            </p>
          )}
        </div>
      )}

      {/* Check runs */}
      <CheckRunsList
        checkRuns={readiness?.checkRuns ?? []}
        checks={
          readiness?.checks.requiredTotal
            ? {
                passed: readiness.checks.passed,
                pending: readiness.checks.pending,
                failed: readiness.checks.failed,
              }
            : undefined
        }
        onRefresh={() => {
          void loadReadiness();
        }}
        isRefreshing={isLoadingReadiness}
        isLoading={isLoadingReadiness && !readiness}
        onFixChecks={onFixChecks}
      />

      {/* Delete branch toggle */}
      <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-2.5">
        <div className="space-y-0.5">
          <p className="text-xs font-medium">Delete source branch</p>
          <p className="text-[10px] text-muted-foreground">
            Deletes the PR branch after merge.
          </p>
        </div>
        <Switch
          checked={deleteBranch}
          onCheckedChange={setDeleteBranch}
          disabled={isSubmitting || isLoadingReadiness}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Merge action */}
      {canMerge ? (
        <div className="flex w-full">
          <Button
            size="sm"
            onClick={() => void handleMerge()}
            disabled={mergeDisabled}
            className={cn(
              "min-w-0 flex-1",
              hasMultipleMethods && "rounded-r-none",
            )}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Merging...
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" />
                {mergeMethodButtonLabels[mergeMethod]}
              </>
            )}
          </Button>
          {hasMultipleMethods && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="default"
                  size="icon"
                  className="h-8 w-8 rounded-l-none border-l border-l-primary-foreground/25"
                  disabled={mergeDisabled}
                  aria-label="Choose merge method"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {allowedMethods.map((method) => (
                  <DropdownMenuItem
                    key={method}
                    className="items-start gap-3 py-2"
                    onSelect={() => setMergeMethod(method)}
                  >
                    <Check
                      className={
                        mergeMethod === method
                          ? "mt-0.5 h-4 w-4"
                          : "mt-0.5 h-4 w-4 opacity-0"
                      }
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-medium">
                        {mergeMethodLabels[method]}
                      </span>
                      <span className="text-muted-foreground text-[10px]">
                        {mergeMethodDescriptions[method]}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      ) : canForce ? (
        <Button
          size="sm"
          variant="destructive"
          className="w-full"
          onClick={handleForceClick}
          disabled={isSubmitting || isLoadingReadiness || !readiness?.pr}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Merging...
            </>
          ) : forceConfirming ? (
            <>
              <AlertTriangle className="mr-2 h-4 w-4" />
              Click again to confirm
            </>
          ) : (
            <>
              <AlertTriangle className="mr-2 h-4 w-4" />
              Merge without passing checks
            </>
          )}
        </Button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main GitPanel component                                             */
/* ------------------------------------------------------------------ */

export function GitPanel(props: GitPanelProps) {
  const { gitPanelOpen, gitPanelTab, setGitPanelTab, diffScope, setDiffScope } =
    useGitPanel();

  if (!gitPanelOpen) return null;

  const {
    session,
    hasRepo,
    hasExistingPr,
    existingPrUrl,
    prDeploymentUrl,
    buildingDeploymentUrl,
    isDeploymentStale,
    hasUncommittedGitChanges,
    supportsRepoCreation,
    hasDiff,
    diffFiles,
    diffSummary,
    onCreateRepoClick,
    onMerged,
    onFixChecks,
    hasSandbox,
    gitStatus,
    refreshGitStatus,
    onCommitted,
    onPrDetected,
    isAgentWorking,
  } = props;

  const hasDiffChanges =
    diffSummary &&
    (diffSummary.totalAdditions > 0 || diffSummary.totalDeletions > 0);
  const showPreviewButton = Boolean(prDeploymentUrl) || isDeploymentStale;
  const previewTargetUrl = isDeploymentStale
    ? buildingDeploymentUrl
    : prDeploymentUrl;

  // Show the PR tab when there's a PR, or when the branch has diverged and changes are committed
  const showGitTab = hasExistingPr || (hasDiff && !hasUncommittedGitChanges);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Panel top bar: PR link or branch name — matches session header height */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        {/* Left: PR link or repo info */}
        <div className="flex min-w-0 items-center gap-2 min-h-7">
          {hasExistingPr && existingPrUrl ? (
            /* oxlint-disable-next-line nextjs/no-html-link-for-pages */
            <a
              href={existingPrUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              {session.prStatus === "merged" ? (
                <GitMerge className="h-3.5 w-3.5 text-purple-500" />
              ) : session.prStatus === "closed" ? (
                <GitPullRequestClosed className="h-3.5 w-3.5 text-red-500" />
              ) : (
                <GitPullRequest className="h-3.5 w-3.5 text-green-500" />
              )}
              #{session.prNumber}
              <ExternalLink className="h-3 w-3 text-muted-foreground" />
            </a>
          ) : hasRepo && session.branch ? (
            <span className="truncate text-xs font-medium text-muted-foreground font-mono">
              {session.branch}
            </span>
          ) : null}
        </div>

        {/* Right: preview / create-repo actions */}
        <div className="flex shrink-0 items-center gap-2">
          {showPreviewButton && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => {
                if (!previewTargetUrl) {
                  return;
                }

                window.open(previewTargetUrl, "_blank", "noopener,noreferrer");
              }}
              disabled={isDeploymentStale && !buildingDeploymentUrl}
            >
              {isDeploymentStale ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Deploying…
                </>
              ) : (
                <>
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Preview
                </>
              )}
            </Button>
          )}
          {!hasRepo && supportsRepoCreation && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={onCreateRepoClick}
            >
              <FolderGit2 className="mr-1.5 h-3.5 w-3.5" />
              Create Repo
            </Button>
          )}
        </div>
      </div>

      {/* Tab bar — matches chat tabs sub-header height */}
      <div className="flex items-center gap-0.5 border-b border-border bg-muted/30 px-2 py-[7px]">
        {["diff" as const, ...(showGitTab ? (["pr"] as const) : [])].map(
          (tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setGitPanelTab(tab)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                gitPanelTab === tab
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-muted/50",
              )}
            >
              {tab === "diff" ? "Changes" : "PR"}
              {tab === "diff" && hasDiffChanges && (
                <span className="ml-1 text-[10px] text-muted-foreground font-mono">
                  {diffFiles?.length ?? 0}
                </span>
              )}
            </button>
          ),
        )}
      </div>

      {/* Panel content */}
      <div
        className={cn(
          "min-h-0 flex-1",
          gitPanelTab === "diff" ? "flex flex-col" : "overflow-y-auto",
        )}
      >
        {gitPanelTab === "diff" && (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Fixed commit area */}
            <div className="shrink-0 p-3 pb-0">
              {hasRepo && (
                <div className="mb-2">
                  <InlineCommitPanel
                    session={session}
                    hasSandbox={hasSandbox}
                    gitStatus={gitStatus}
                    refreshGitStatus={refreshGitStatus}
                    onCommitted={onCommitted}
                    isAgentWorking={isAgentWorking}
                  />
                </div>
              )}

              {/* Separator */}
              {hasRepo && diffFiles && diffFiles.length > 0 && (
                <div className="mb-2 border-t border-border" />
              )}

              {/* Scope toggle */}
              {diffFiles && diffFiles.length > 0 && (
                <div className="mb-2 flex items-center gap-1 px-1">
                  <button
                    type="button"
                    onClick={() => setDiffScope("uncommitted")}
                    className={cn(
                      "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                      diffScope === "uncommitted"
                        ? "bg-secondary text-secondary-foreground"
                        : "text-muted-foreground hover:bg-muted/50",
                    )}
                  >
                    Uncommitted
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiffScope("branch")}
                    className={cn(
                      "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                      diffScope === "branch"
                        ? "bg-secondary text-secondary-foreground"
                        : "text-muted-foreground hover:bg-muted/50",
                    )}
                  >
                    All Changes
                  </button>
                </div>
              )}

              {/* File summary */}
              {diffFiles &&
                diffFiles.length > 0 &&
                hasDiffChanges &&
                (() => {
                  const visibleFiles =
                    diffScope === "branch"
                      ? diffFiles
                      : diffFiles.filter(isUncommittedFile);
                  const adds = visibleFiles.reduce(
                    (sum, f) => sum + f.additions,
                    0,
                  );
                  const dels = visibleFiles.reduce(
                    (sum, f) => sum + f.deletions,
                    0,
                  );
                  return (
                    <div className="mb-2 flex items-center gap-2 px-2 text-xs text-muted-foreground">
                      <span>
                        {visibleFiles.length} file
                        {visibleFiles.length !== 1 ? "s" : ""} changed
                      </span>
                      {adds > 0 && (
                        <span className="text-green-600 dark:text-green-500">
                          +{adds}
                        </span>
                      )}
                      {dels > 0 && (
                        <span className="text-red-600 dark:text-red-400">
                          -{dels}
                        </span>
                      )}
                    </div>
                  );
                })()}
            </div>

            {/* Scrollable file list */}
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              {diffFiles && diffFiles.length > 0 ? (
                <DiffFileList files={diffFiles} />
              ) : (
                <div className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/25 py-8 text-center">
                  <p className="text-xs text-muted-foreground">
                    {!hasSandbox
                      ? "Waiting for sandbox..."
                      : diffFiles === null
                        ? "Loading..."
                        : "No file changes yet"}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {gitPanelTab === "pr" && (
          <div className="p-3">
            {hasExistingPr ? (
              <InlineMergePanel
                session={session}
                onMerged={onMerged}
                onFixChecks={onFixChecks}
              />
            ) : hasRepo ? (
              <InlinePrCreatePanel
                session={session}
                hasSandbox={hasSandbox}
                gitStatus={gitStatus}
                refreshGitStatus={refreshGitStatus}
                hasUncommittedGitChanges={hasUncommittedGitChanges}
                onPrDetected={onPrDetected}
                isAgentWorking={isAgentWorking}
              />
            ) : (
              <div className="text-center text-xs text-muted-foreground py-6">
                Create a repo first
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
