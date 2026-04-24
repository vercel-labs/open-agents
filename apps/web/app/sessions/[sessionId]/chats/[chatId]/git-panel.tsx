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
  Globe,
  Loader2,
  RefreshCw,
  Sparkles,
  SquareDot,
  SquareMinus,
  SquarePlus,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DiffFile } from "@/app/api/sessions/[sessionId]/diff/route";
import type { WebAgentUIMessage } from "@/app/types";
import type { MergeReadinessResponse } from "@/app/api/sessions/[sessionId]/merge-readiness/route";
import type { MergePullRequestResponse } from "@/app/api/sessions/[sessionId]/merge/route";
import type { Session } from "@/lib/db/schema";
import type {
  PullRequestCheckRun,
  PullRequestMergeMethod,
} from "@/lib/github/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CheckRunsList } from "@/components/merge-check-runs";
import {
  MERGE_READINESS_POLL_INTERVAL_MS,
  shouldIncrementMergeReadinessTransientPollCount,
  shouldPollMergeReadiness,
} from "@/lib/merge-readiness-polling";
import { cn } from "@/lib/utils";
import {
  commitAndPushSessionChanges,
  createSessionBranch,
  discardSessionUncommittedChanges,
  fetchRepoBranches,
  generatePullRequestContent,
} from "@/lib/git-flow-client";
import type { SessionGitStatus } from "@/hooks/use-session-git-status";
import { useSessionFiles } from "@/hooks/use-session-files";
import { useGitHubConnectionStatus } from "@/hooks/use-github-connection-status";
import { useGitPanel } from "./git-panel-context";
import { FileTree } from "./file-tree";
import { useSessionChatWorkspaceContext } from "./session-chat-context";

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
  failedDeploymentUrl: string | null;
  isDeploymentStale: boolean;
  isDeploymentFailed: boolean;
  hasUncommittedGitChanges: boolean;
  supportsRepoCreation: boolean;
  hasDiff: boolean;
  canCloseAndArchive: boolean;

  // Diff data
  diffFiles: DiffFile[] | null;
  diffSummary?: {
    totalAdditions: number;
    totalDeletions: number;
  } | null;
  diffRefreshing: boolean;

  // Actions
  onCreateRepoClick: () => void;
  refreshDiff: () => Promise<void>;

  // Merge
  onMerged: (result: MergePullRequestResponse) => Promise<void> | void;
  onCloseAndArchiveClick: () => void;
  onFixChecks?: (failedRuns: PullRequestCheckRun[]) => Promise<void> | void;
  onFixConflicts?: (baseBranchRef: string) => Promise<void> | void;

  // For inline commit
  hasSandbox: boolean;
  gitStatus: SessionGitStatus | null;
  gitStatusLoading: boolean;
  refreshGitStatus: () => Promise<SessionGitStatus | undefined>;
  onCommitted?: () => void;
  isAgentWorking: boolean;

  // For inline PR creation
  onPrDetected?: (info: {
    prNumber: number;
    prStatus: "open" | "merged" | "closed";
  }) => void;
  onGitMessage?: (message: WebAgentUIMessage) => Promise<void> | void;
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

function canDiscardFile(file: DiffFile): boolean {
  return isUncommittedFile(file);
}

function DiffFileList({
  files,
  onDiscardFile,
  discardingFilePath,
  discardDisabled,
}: {
  files: DiffFile[];
  onDiscardFile: (file: DiffFile) => void;
  discardingFilePath: string | null;
  discardDisabled: boolean;
}) {
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
            <div
              key={file.path}
              className="group flex items-center gap-1 rounded-md px-2 py-1.5 transition-colors hover:bg-accent"
            >
              <button
                type="button"
                onClick={() => openDiffToFile(file.path)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <DiffFileStatusIcon status={file.status} />
                <div className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
                  <span className="shrink-0 font-mono text-xs font-medium text-foreground">
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
              {canDiscardFile(file) ? (
                <button
                  type="button"
                  onClick={() => onDiscardFile(file)}
                  disabled={discardDisabled || discardingFilePath === file.path}
                  aria-label={`Discard changes in ${file.path}`}
                  className="rounded p-1 text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-100"
                >
                  {discardingFilePath === file.path ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* GitHub connection warning banner                                     */
/* ------------------------------------------------------------------ */

function GitHubConnectionWarning({
  status,
  reconnectRequired,
}: {
  status: string | null;
  reconnectRequired: boolean;
}) {
  if (reconnectRequired) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
        Your GitHub connection needs to be refreshed.{" "}
        {/* oxlint-disable-next-line nextjs/no-html-link-for-pages */}
        <a href="/settings/connections" className="underline">
          Reconnect
        </a>
      </div>
    );
  }
  if (status === "not_connected") {
    return (
      <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
        Connect GitHub to push changes.{" "}
        {/* oxlint-disable-next-line nextjs/no-html-link-for-pages */}
        <a href="/settings/connections" className="underline">
          Go to settings
        </a>
      </div>
    );
  }
  return null;
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
  baseBranch,
  connectionStatus,
  reconnectRequired,
}: {
  session: Session;
  hasSandbox: boolean;
  gitStatus: SessionGitStatus | null;
  refreshGitStatus: () => Promise<SessionGitStatus | undefined>;
  onCommitted?: () => void;
  isAgentWorking: boolean;
  baseBranch: string;
  connectionStatus: string | null;
  reconnectRequired: boolean;
}) {
  const [commitMessage, setCommitMessage] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [isGeneratingMessage, setIsGeneratingMessage] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitSuccess, setCommitSuccess] = useState<{
    commitSha?: string;
    commitMessage?: string;
  } | null>(null);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [resolvedBranch, setResolvedBranch] = useState<string | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

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

  const handleExpandCommit = () => {
    setIsExpanded(true);
  };

  const handleGenerateMessage = async () => {
    setIsGeneratingMessage(true);
    try {
      const res = await fetch(
        `/api/sessions/${session.id}/generate-commit-message`,
        { method: "POST" },
      );
      const data = await res.json();
      if (data.message) {
        setCommitMessage(data.message);
      }
    } catch {
      // silently fail
    } finally {
      setIsGeneratingMessage(false);
    }
  };

  const handleCommit = async (skipPush = false) => {
    if (!hasSandbox || !hasPendingGitWork) return;
    setIsCommitting(true);
    setCommitError(null);
    setCommitSuccess(null);

    try {
      const trimmed = commitMessage.trim();
      const lines = trimmed.split("\n");
      const commitTitle = lines[0] ?? "";
      const commitBody = lines.slice(1).join("\n").trim();

      const response = await commitAndPushSessionChanges({
        sessionId: session.id,
        sessionTitle: session.title,
        baseBranch,
        branchName: displayBranch,
        ...(commitTitle ? { commitTitle, commitBody } : {}),
        skipPush,
      });

      if (response.branchName && response.branchName !== "HEAD") {
        setResolvedBranch(response.branchName);
      }

      setCommitSuccess({
        commitSha: response.gitActions?.commitSha,
        commitMessage:
          response.gitActions?.commitMessage ??
          (skipPush ? "Changes committed" : "Changes committed & pushed"),
      });
      setCommitMessage("");

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
        <GitHubConnectionWarning
          status={connectionStatus}
          reconnectRequired={reconnectRequired}
        />
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

  const commitDisabled =
    isAgentWorking || isCommitting || !hasSandbox || !hasPendingGitWork;

  // Commit form
  const commitForm = (
    <div className="space-y-2">
      <GitHubConnectionWarning
        status={connectionStatus}
        reconnectRequired={reconnectRequired}
      />
      {isExpanded && (
        <div className="relative">
          <Textarea
            placeholder="Commit message"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            disabled={isAgentWorking || isCommitting || !hasPendingGitWork}
            rows={2}
            className="resize-none pb-7 text-xs"
          />
          <button
            type="button"
            className="absolute bottom-1.5 left-1.5 rounded p-1 text-muted-foreground/40 transition-colors hover:bg-muted/50 hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-50"
            onClick={() => void handleGenerateMessage()}
            disabled={isGeneratingMessage || !hasPendingGitWork}
          >
            {isGeneratingMessage ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <WandSparkles className="h-3 w-3" />
            )}
          </button>
        </div>
      )}
      {commitSuccess ? (
        <div className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-green-500/30 bg-green-500/10 text-xs font-medium text-green-700 dark:text-green-300">
          <Check className="h-3.5 w-3.5" />
          Committed
        </div>
      ) : (
        <>
          <div className="flex w-full">
            <Button
              size="sm"
              className="min-w-0 flex-1 rounded-r-none text-xs"
              onClick={() => void handleCommit()}
              disabled={commitDisabled}
            >
              {isCommitting ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Committing...
                </>
              ) : (
                <>
                  {isExpanded ? (
                    <GitCommit className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Commit & Push
                </>
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="default"
                  size="icon"
                  className="h-8 w-8 rounded-l-none border-l border-l-primary-foreground/25"
                  disabled={commitDisabled}
                  aria-label="Commit options"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[10rem]">
                <DropdownMenuItem
                  onSelect={() => void handleCommit(true)}
                  className="gap-2 text-xs"
                >
                  Commit only
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {!isExpanded && (
            <button
              type="button"
              className="w-full text-center text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
              onClick={handleExpandCommit}
              disabled={!hasPendingGitWork}
            >
              Edit message
            </button>
          )}
        </>
      )}
      {commitError && (
        <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          {commitError}
        </div>
      )}
    </div>
  );

  const disabledTooltip = isAgentWorking
    ? "Wait for the agent to finish"
    : !hasSandbox
      ? "Waiting for sandbox to start"
      : null;

  if (disabledTooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div>{commitForm}</div>
        </TooltipTrigger>
        <TooltipContent side="bottom">{disabledTooltip}</TooltipContent>
      </Tooltip>
    );
  }

  return commitForm;
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
  onGitMessage,
  isAgentWorking,
  baseBranch,
  connectionStatus,
  reconnectRequired,
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
  onGitMessage?: (message: WebAgentUIMessage) => Promise<void> | void;
  isAgentWorking: boolean;
  baseBranch: string;
  connectionStatus: string | null;
  reconnectRequired: boolean;
}) {
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [isCreatingPr, setIsCreatingPr] = useState(false);
  const [prError, setPrError] = useState<string | null>(null);
  const [prSuccess, setPrSuccess] = useState<{
    prUrl: string;
    requiresManualCreation?: boolean;
    isDraft?: boolean;
    autoMergeEnabled?: boolean;
    autoMergeError?: string;
  } | null>(null);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [resolvedBranch, setResolvedBranch] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [enableAutoMerge, setEnableAutoMerge] = useState(false);

  const branchFromStatus =
    resolvedBranch ??
    (gitStatus?.branch && gitStatus.branch !== "HEAD"
      ? gitStatus.branch
      : null);
  const currentBranch = branchFromStatus ?? session.branch ?? baseBranch;
  const displayBranch = currentBranch === "HEAD" ? baseBranch : currentBranch;
  const isDetachedHead = gitStatus?.isDetachedHead ?? false;
  const needsNewBranch = displayBranch === baseBranch || isDetachedHead;

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

  const handleExpand = () => {
    setIsExpanded(true);
  };

  const handleGenerateContent = async () => {
    setIsGenerating(true);
    try {
      const generated = await generatePullRequestContent({
        sessionId: session.id,
        sessionTitle: session.title,
        baseBranch,
        branchName: displayBranch,
      });
      setPrTitle(generated.title ?? session.title);
      setPrBody(generated.body ?? "");
      if (generated.branchName && generated.branchName !== "HEAD") {
        setResolvedBranch(generated.branchName);
      }
    } catch {
      // silently fail
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreatePr = async (isDraft = false) => {
    setIsCreatingPr(true);
    setPrError(null);

    const gitMessageId = crypto.randomUUID();
    const prPartId = `${gitMessageId}:pr`;

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
          if (generated.branchName && generated.branchName !== "HEAD") {
            setResolvedBranch(generated.branchName);
          }
        } finally {
          setIsGenerating(false);
        }
      }

      // Emit pending data-pr part
      await onGitMessage?.({
        id: gitMessageId,
        role: "assistant",
        metadata: {},
        parts: [
          {
            type: "data-pr",
            id: prPartId,
            data: { status: "pending" },
          },
        ],
      });

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
          isDraft,
          enableAutoMerge: !isDraft && enableAutoMerge,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create PR");
      }

      setPrSuccess({
        prUrl: data.prUrl,
        requiresManualCreation: Boolean(data.requiresManualCreation),
        isDraft,
        autoMergeEnabled: Boolean(data.autoMergeEnabled),
        autoMergeError:
          typeof data.autoMergeError === "string"
            ? data.autoMergeError
            : undefined,
      });

      await onGitMessage?.({
        id: gitMessageId,
        role: "assistant",
        metadata: {},
        parts: [
          {
            type: "data-pr",
            id: prPartId,
            data: {
              status: "success",
              created: true,
              prNumber:
                typeof data.prNumber === "number" ? data.prNumber : undefined,
              url: typeof data.prUrl === "string" ? data.prUrl : undefined,
            },
          },
        ],
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
      const errorMessage =
        err instanceof Error ? err.message : "Failed to create PR";
      await onGitMessage?.({
        id: gitMessageId,
        role: "assistant",
        metadata: {},
        parts: [
          {
            type: "data-pr",
            id: prPartId,
            data: {
              status: "error",
              error: errorMessage,
            },
          },
        ],
      });
      setPrError(errorMessage);
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
              : prSuccess.autoMergeEnabled
                ? "PR created — auto-merge enabled!"
                : prSuccess.isDraft
                  ? "Draft pull request created!"
                  : "Pull request created!"}
          </span>
        </div>
        {prSuccess.autoMergeError && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
            {prSuccess.autoMergeError}
          </div>
        )}
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
    const branchDisabledTooltip = isAgentWorking
      ? "Wait for the agent to finish"
      : !hasSandbox
        ? "Waiting for sandbox to start"
        : null;

    const branchContent = (
      <div className="space-y-2">
        <GitHubConnectionWarning
          status={connectionStatus}
          reconnectRequired={reconnectRequired}
        />
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
        {prError && (
          <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            {prError}
          </div>
        )}
      </div>
    );

    if (branchDisabledTooltip) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <div>{branchContent}</div>
          </TooltipTrigger>
          <TooltipContent side="bottom">{branchDisabledTooltip}</TooltipContent>
        </Tooltip>
      );
    }

    return branchContent;
  }

  // Uncommitted changes warning
  if (hasUncommittedGitChanges) {
    return (
      <div className="px-2 py-3 text-center text-xs text-muted-foreground">
        Commit your changes before creating a pull request.
      </div>
    );
  }

  const prDisabled = isAgentWorking || isCreatingPr || !hasSandbox;

  const prDisabledTooltip = isAgentWorking
    ? "Wait for the agent to finish"
    : !hasSandbox
      ? "Waiting for sandbox to start"
      : null;

  // PR creation form
  const prForm = (
    <div className="space-y-2">
      <GitHubConnectionWarning
        status={connectionStatus}
        reconnectRequired={reconnectRequired}
      />
      {isExpanded && (
        <>
          <div className="relative">
            <Input
              placeholder="PR title"
              value={prTitle}
              onChange={(e) => setPrTitle(e.target.value)}
              disabled={isAgentWorking || isCreatingPr}
              className="h-8 pr-7 text-xs"
            />
            <button
              type="button"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground/40 transition-colors hover:bg-muted/50 hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-50"
              onClick={() => void handleGenerateContent()}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <WandSparkles className="h-3 w-3" />
              )}
            </button>
          </div>
          <Textarea
            placeholder="Description"
            value={prBody}
            onChange={(e) => setPrBody(e.target.value)}
            disabled={isAgentWorking || isCreatingPr}
            rows={3}
            className="max-h-40 text-xs"
          />
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-2">
            <div className="space-y-0.5 pr-3">
              <p className="text-xs font-medium">Auto-merge</p>
              <p className="text-[10px] text-muted-foreground">
                Merge automatically once checks pass.
              </p>
            </div>
            <Switch
              checked={enableAutoMerge}
              onCheckedChange={setEnableAutoMerge}
              disabled={isAgentWorking || isCreatingPr}
            />
          </div>
        </>
      )}
      <div className="flex w-full">
        <Button
          size="sm"
          className="min-w-0 flex-1 rounded-r-none text-xs"
          onClick={() => void handleCreatePr()}
          disabled={prDisabled}
        >
          {isCreatingPr ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              {isGenerating ? "Generating..." : "Creating..."}
            </>
          ) : (
            <>
              {isExpanded ? (
                <GitPullRequest className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              )}
              Create Pull Request
            </>
          )}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="default"
              size="icon"
              className="h-8 w-8 rounded-l-none border-l border-l-primary-foreground/25"
              disabled={prDisabled}
              aria-label="PR options"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[10rem]">
            <DropdownMenuItem
              onSelect={() => void handleCreatePr(true)}
              className="gap-2 text-xs"
            >
              Create Draft PR
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {!isExpanded && (
        <button
          type="button"
          className="w-full text-center text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          onClick={handleExpand}
        >
          Edit title & description
        </button>
      )}
      {prError && (
        <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          {prError}
        </div>
      )}
    </div>
  );

  if (prDisabledTooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div>{prForm}</div>
        </TooltipTrigger>
        <TooltipContent side="bottom">{prDisabledTooltip}</TooltipContent>
      </Tooltip>
    );
  }

  return prForm;
}

/* ------------------------------------------------------------------ */
/* Inline merge UI (replaces the modal dialog)                         */
/* ------------------------------------------------------------------ */

function InlineMergePanel({
  session,
  onMerged,
  onCloseAndArchiveClick,
  canCloseAndArchive,
  onFixChecks,
  onFixConflicts,
  isAgentWorking,
}: {
  session: Session;
  onMerged: (result: MergePullRequestResponse) => Promise<void> | void;
  onCloseAndArchiveClick: () => void;
  canCloseAndArchive: boolean;
  onFixChecks?: (failedRuns: PullRequestCheckRun[]) => Promise<void> | void;
  onFixConflicts?: (baseBranchRef: string) => Promise<void> | void;
  isAgentWorking: boolean;
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
  const [transientPollCount, setTransientPollCount] = useState(0);

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
      setMergeMethod((currentMergeMethod) =>
        readinessPayload.allowedMethods.includes(currentMergeMethod)
          ? currentMergeMethod
          : readinessPayload.defaultMethod,
      );
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

  useEffect(() => {
    setTransientPollCount(0);
  }, [session.prNumber]);

  // Load readiness on mount
  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      void loadReadiness();
    }
  }, [loadReadiness]);

  useEffect(() => {
    if (!shouldIncrementMergeReadinessTransientPollCount(readiness)) {
      setTransientPollCount(0);
    }
  }, [readiness]);

  useEffect(() => {
    if (
      isLoadingReadiness ||
      !shouldPollMergeReadiness({ readiness, transientPollCount })
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (shouldIncrementMergeReadinessTransientPollCount(readiness)) {
        setTransientPollCount((currentCount) => currentCount + 1);
      }
      void loadReadiness();
    }, MERGE_READINESS_POLL_INTERVAL_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isLoadingReadiness, loadReadiness, readiness, transientPollCount]);

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

  const isInitialReadinessLoading = isLoadingReadiness && !readiness;

  const forceBypassableReasons = new Set([
    "Required checks are failing",
    "Required checks are still pending",
    "Required checks are still in progress",
    "Branch protection requirements are not yet satisfied",
  ]);
  const nonBypassableReasons =
    readiness?.reasons.filter(
      (reason) => !forceBypassableReasons.has(reason),
    ) ?? [];
  const hasMergeConflicts = nonBypassableReasons.some((reason) =>
    reason.toLowerCase().includes("merge conflict"),
  );
  const baseBranchRef = readiness?.pr?.baseBranch
    ? `origin/${readiness.pr.baseBranch}`
    : "origin/main";

  const canForce =
    readiness !== null &&
    !readiness.canMerge &&
    readiness.pr !== null &&
    nonBypassableReasons.length === 0;

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
    isSubmitting || isInitialReadinessLoading || !readiness || !readiness.pr;

  const prTitle = readiness?.pr?.title ?? null;
  const prBody = readiness?.pr?.body ?? null;

  if (session.prStatus === "merged") {
    return (
      <div className="space-y-3">
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
        <div className="relative overflow-hidden rounded-md border border-purple-500/30 bg-purple-500/10">
          <div className="absolute inset-y-0 left-0 w-1 bg-purple-500" />
          <div className="flex items-center gap-2.5 py-3 pr-3 pl-4">
            <GitMerge className="h-4 w-4 shrink-0 text-purple-500" />
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-foreground">
                Pull request merged
              </p>
              <p className="text-[11px] text-muted-foreground">
                The branch has been merged and can be safely deleted.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

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

      {/* Diff stats */}
      {readiness?.pr &&
        (readiness.pr.changedFiles > 0 ||
          readiness.pr.additions > 0 ||
          readiness.pr.deletions > 0) && (
          <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
            <span>
              {readiness.pr.changedFiles} file
              {readiness.pr.changedFiles !== 1 ? "s" : ""} changed
            </span>
            {readiness.pr.additions > 0 && (
              <span className="text-green-600 dark:text-green-500">
                +{readiness.pr.additions}
              </span>
            )}
            {readiness.pr.deletions > 0 && (
              <span className="text-red-600 dark:text-red-400">
                -{readiness.pr.deletions}
              </span>
            )}
            {readiness.pr.commits > 0 && (
              <span className="ml-auto flex items-center gap-1 text-muted-foreground">
                <GitCommit className="h-3 w-3" />
                {readiness.pr.commits}
              </span>
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
        isLoading={isInitialReadinessLoading}
        fixChecksDisabled={isAgentWorking}
        onFixChecks={onFixChecks}
      />

      {nonBypassableReasons.length > 0 && (
        <div className="relative overflow-hidden rounded-md border border-border bg-muted/40">
          <div className="absolute inset-y-0 left-0 w-1 bg-amber-500 dark:bg-amber-400" />
          <div className="space-y-2.5 py-2.5 pr-2.5 pl-3.5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs font-medium text-foreground">
                Merge blocked
              </p>
            </div>
            <div className="space-y-1 pl-[22px]">
              {nonBypassableReasons.map((reason) => (
                <p
                  key={reason}
                  className="text-[11px] leading-snug text-muted-foreground"
                >
                  {reason}
                </p>
              ))}
              {hasMergeConflicts && (
                <p className="text-[10px] leading-relaxed text-muted-foreground/80">
                  Fetch{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground/70">
                    {baseBranchRef}
                  </code>
                  , resolve the conflicts, and avoid rebasing.
                </p>
              )}
            </div>
            {hasMergeConflicts && onFixConflicts && (
              <div className="pl-[22px]">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={isAgentWorking}
                  onClick={() => {
                    void onFixConflicts(baseBranchRef);
                  }}
                >
                  <Sparkles className="mr-1.5 h-3 w-3" />
                  Fix conflicts
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

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
          disabled={isSubmitting || isInitialReadinessLoading}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Merge action */}
      <div className="space-y-2">
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

        {canCloseAndArchive ? (
          <Button
            size="sm"
            variant="destructive"
            className="w-full"
            onClick={onCloseAndArchiveClick}
            disabled={isSubmitting}
          >
            <GitPullRequestClosed className="mr-2 h-4 w-4" />
            Close & Archive
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main GitPanel component                                             */
/* ------------------------------------------------------------------ */

export function GitPanel(props: GitPanelProps) {
  const {
    gitPanelOpen,
    gitPanelTab,
    setGitPanelTab,
    diffScope,
    setDiffScope,
    openFileTab,
  } = useGitPanel();

  const {
    session,
    hasRepo,
    hasExistingPr,
    existingPrUrl,
    prDeploymentUrl,
    buildingDeploymentUrl,
    failedDeploymentUrl,
    isDeploymentStale,
    isDeploymentFailed,
    hasUncommittedGitChanges,
    supportsRepoCreation,
    hasDiff,
    canCloseAndArchive,
    diffFiles,
    diffSummary,
    diffRefreshing,
    onCreateRepoClick,
    refreshDiff,
    onMerged,
    onCloseAndArchiveClick,
    onFixChecks,
    onFixConflicts,
    hasSandbox,
    gitStatus,
    gitStatusLoading,
    refreshGitStatus,
    onCommitted,
    onPrDetected,
    onGitMessage,
    isAgentWorking,
  } = props;
  const { refreshFiles } = useSessionChatWorkspaceContext();
  const { status: connectionStatus, reconnectRequired } =
    useGitHubConnectionStatus({ enabled: hasRepo });
  const [baseBranch, setBaseBranch] = useState("main");
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<{
    filePath: string;
    oldPath?: string;
  } | null>(null);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const [isDiscardingChanges, setIsDiscardingChanges] = useState(false);

  const handleDiscardChanges = useCallback(async () => {
    setIsDiscardingChanges(true);
    setDiscardError(null);

    try {
      await discardSessionUncommittedChanges({
        sessionId: session.id,
        ...(discardTarget ? { filePath: discardTarget.filePath } : {}),
        ...(discardTarget?.oldPath ? { oldPath: discardTarget.oldPath } : {}),
      });
    } catch (error) {
      setDiscardError(
        error instanceof Error
          ? error.message
          : "Failed to discard uncommitted changes",
      );
      setIsDiscardingChanges(false);
      return;
    }

    await Promise.allSettled([
      refreshDiff(),
      refreshGitStatus(),
      refreshFiles(),
    ]);
    setDiscardDialogOpen(false);
    setDiscardTarget(null);
    setIsDiscardingChanges(false);
  }, [discardTarget, refreshDiff, refreshFiles, refreshGitStatus, session.id]);

  useEffect(() => {
    if (!session.repoOwner || !session.repoName) {
      return;
    }

    let cancelled = false;

    void fetchRepoBranches(session.repoOwner, session.repoName)
      .then((data) => {
        if (!cancelled) {
          setBaseBranch(data.defaultBranch);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [session.repoOwner, session.repoName]);

  const { files: sessionFiles, isLoading: filesLoading } = useSessionFiles(
    session.id,
    hasSandbox,
  );

  const hasDiffChanges =
    diffSummary &&
    (diffSummary.totalAdditions > 0 || diffSummary.totalDeletions > 0);
  const hasUnstagedChanges =
    (gitStatus?.unstagedCount ?? 0) > 0 ||
    Boolean(diffFiles?.some(isUncommittedFile));
  const showPreviewButton =
    Boolean(prDeploymentUrl) || isDeploymentStale || isDeploymentFailed;
  const previewTargetUrl = isDeploymentStale
    ? buildingDeploymentUrl
    : (prDeploymentUrl ?? (isDeploymentFailed ? failedDeploymentUrl : null));

  const canOpenPrTab =
    hasExistingPr ||
    (hasRepo && gitStatus !== null && hasDiff && !hasUncommittedGitChanges);
  const prTabDisabledReason = canOpenPrTab
    ? null
    : !hasRepo
      ? "Create a repo first"
      : gitStatus === null
        ? "Loading git status..."
        : hasUncommittedGitChanges
          ? "Commit your changes before creating a pull request."
          : "Commit changes to your branch before creating a pull request.";
  const showCreatePrShortcut = hasRepo && !hasExistingPr && canOpenPrTab;
  const isRefreshingChanges = diffRefreshing || gitStatusLoading;
  const diffScopeManuallySetRef = useRef(false);

  useEffect(() => {
    if (!gitPanelOpen) {
      diffScopeManuallySetRef.current = false;
      return;
    }

    if (!diffScopeManuallySetRef.current) {
      setDiffScope(hasUnstagedChanges ? "uncommitted" : "branch");
    }
  }, [gitPanelOpen, hasUnstagedChanges, setDiffScope]);

  useEffect(() => {
    if (gitPanelTab === "pr" && prTabDisabledReason) {
      setGitPanelTab("diff");
    }
  }, [gitPanelTab, prTabDisabledReason, setGitPanelTab]);

  const discardTitle = discardTarget
    ? "Discard file changes?"
    : "Discard uncommitted changes?";
  const discardDescription = discardTarget
    ? `This permanently removes local changes for ${discardTarget.filePath}. Committed changes stay intact.`
    : "This permanently removes local uncommitted changes from the sandbox. Committed changes stay intact.";
  const discardingFilePath = discardTarget?.filePath ?? null;
  const gitPanelTabs = [
    "files" as const,
    "diff" as const,
    ...(canOpenPrTab ? (["pr"] as const) : []),
  ];

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Panel top bar: PR link or branch name — matches session header height */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        {/* Left: PR link or repo info */}
        <div className="flex min-h-7 min-w-0 items-center gap-2">
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
          ) : hasRepo && showCreatePrShortcut ? (
            <button
              type="button"
              onClick={() => setGitPanelTab("pr")}
              className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              <GitPullRequest className="h-3.5 w-3.5" />
              Create PR
            </button>
          ) : null}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {showPreviewButton && previewTargetUrl && (
            /* oxlint-disable-next-line nextjs/no-html-link-for-pages */
            <a
              href={previewTargetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              <Globe
                className={cn(
                  "h-3.5 w-3.5",
                  isDeploymentFailed && "text-red-500",
                  !isDeploymentFailed && !isDeploymentStale && "text-green-500",
                  !isDeploymentFailed &&
                    isDeploymentStale &&
                    "text-amber-500 animate-pulse",
                )}
              />
              Preview
              <ExternalLink className="h-3 w-3 text-muted-foreground" />
            </a>
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
        {gitPanelTabs.map((tab) => (
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
            {tab === "files" ? "Files" : tab === "diff" ? "Changes" : "PR"}
            {tab === "diff" && hasDiffChanges && (
              <span className="ml-1 text-[10px] text-muted-foreground font-mono">
                {diffFiles?.length ?? 0}
              </span>
            )}
          </button>
        ))}
        {!canOpenPrTab && prTabDisabledReason && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-disabled="true"
                className="cursor-not-allowed rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground opacity-50"
              >
                PR
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{prTabDisabledReason}</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Panel content */}
      <div
        className={cn(
          "min-h-0 flex-1",
          gitPanelTab === "diff" || gitPanelTab === "files"
            ? "flex flex-col"
            : "overflow-y-auto",
        )}
      >
        {gitPanelTab === "files" && (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {filesLoading ? (
              <div className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/25 py-8 text-center">
                <p className="text-xs text-muted-foreground">Loading files…</p>
              </div>
            ) : sessionFiles && sessionFiles.length > 0 ? (
              <FileTree
                files={sessionFiles}
                onFileClick={(filePath) => openFileTab(filePath)}
              />
            ) : (
              <div className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/25 py-8 text-center">
                <p className="text-xs text-muted-foreground">
                  {!hasSandbox ? "Waiting for sandbox…" : "No files found"}
                </p>
              </div>
            )}
          </div>
        )}

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
                    baseBranch={baseBranch}
                    connectionStatus={connectionStatus}
                    reconnectRequired={reconnectRequired}
                  />
                </div>
              )}

              {/* Separator */}
              {hasRepo && diffFiles && diffFiles.length > 0 && (
                <div className="mb-2 border-t border-border" />
              )}

              {/* Scope toggle */}
              {diffFiles && diffFiles.length > 0 && (
                <div className="mb-2 flex items-center justify-between gap-2 px-1">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        diffScopeManuallySetRef.current = true;
                        setDiffScope("branch");
                      }}
                      className={cn(
                        "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                        diffScope === "branch"
                          ? "bg-secondary text-secondary-foreground"
                          : "text-muted-foreground hover:bg-muted/50",
                      )}
                    >
                      All Changes
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        diffScopeManuallySetRef.current = true;
                        setDiffScope("uncommitted");
                      }}
                      className={cn(
                        "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                        diffScope === "uncommitted"
                          ? "bg-secondary text-secondary-foreground"
                          : "text-muted-foreground hover:bg-muted/50",
                      )}
                    >
                      Uncommitted
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    {hasUncommittedGitChanges ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDiscardTarget(null);
                          setDiscardError(null);
                          setDiscardDialogOpen(true);
                        }}
                        disabled={
                          !hasSandbox || isDiscardingChanges || isAgentWorking
                        }
                        className="h-6 w-6 shrink-0 px-0 text-muted-foreground hover:text-destructive"
                        title="Discard uncommitted changes"
                        aria-label="Discard uncommitted changes"
                      >
                        {isDiscardingChanges ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        void Promise.all([
                          refreshDiff(),
                          refreshGitStatus(),
                          refreshFiles(),
                        ]);
                      }}
                      disabled={!hasSandbox || isRefreshingChanges}
                      className="h-6 w-6 shrink-0 px-0"
                      title="Refresh changes"
                      aria-label="Refresh changes"
                    >
                      <RefreshCw
                        className={cn(
                          "h-3.5 w-3.5",
                          isRefreshingChanges && "animate-spin",
                        )}
                      />
                    </Button>
                  </div>
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
                    <div className="mb-2 flex items-center justify-between gap-2 px-2">
                      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
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
                    </div>
                  );
                })()}
            </div>

            {/* Scrollable file list */}
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              {diffFiles && diffFiles.length > 0 ? (
                <DiffFileList
                  files={diffFiles}
                  onDiscardFile={(file) => {
                    setDiscardTarget({
                      filePath: file.path,
                      ...(file.oldPath ? { oldPath: file.oldPath } : {}),
                    });
                    setDiscardError(null);
                    setDiscardDialogOpen(true);
                  }}
                  discardingFilePath={
                    isDiscardingChanges && discardTarget
                      ? discardingFilePath
                      : null
                  }
                  discardDisabled={isDiscardingChanges || isAgentWorking}
                />
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
                onCloseAndArchiveClick={onCloseAndArchiveClick}
                canCloseAndArchive={canCloseAndArchive}
                onFixChecks={onFixChecks}
                onFixConflicts={onFixConflicts}
                isAgentWorking={isAgentWorking}
              />
            ) : hasRepo ? (
              <InlinePrCreatePanel
                session={session}
                hasSandbox={hasSandbox}
                gitStatus={gitStatus}
                refreshGitStatus={refreshGitStatus}
                hasUncommittedGitChanges={hasUncommittedGitChanges}
                onPrDetected={onPrDetected}
                onGitMessage={onGitMessage}
                isAgentWorking={isAgentWorking}
                baseBranch={baseBranch}
                connectionStatus={connectionStatus}
                reconnectRequired={reconnectRequired}
              />
            ) : (
              <div className="text-center text-xs text-muted-foreground py-6">
                Create a repo first
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog
        open={discardDialogOpen}
        onOpenChange={(open) => {
          if (!isDiscardingChanges) {
            setDiscardDialogOpen(open);
          }
          if (!open) {
            setDiscardError(null);
            setDiscardTarget(null);
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{discardTitle}</DialogTitle>
            <DialogDescription>{discardDescription}</DialogDescription>
          </DialogHeader>
          {discardError ? (
            <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              {discardError}
            </div>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={isDiscardingChanges}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => void handleDiscardChanges()}
              disabled={isDiscardingChanges}
            >
              {isDiscardingChanges ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Discarding...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  {discardTarget ? "Discard file" : "Discard changes"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
