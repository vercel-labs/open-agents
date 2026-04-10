"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  GitMerge,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { CheckRunsList } from "@/components/merge-check-runs";
import { MergePrDialogActions } from "@/components/merge-pr-dialog-actions";
import {
  MERGE_READINESS_POLL_INTERVAL_MS,
  shouldPollMergeReadiness,
} from "@/lib/merge-readiness-polling";

interface MergePrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session;
  onMerged?: (result: MergePullRequestResponse) => Promise<void> | void;
  onViewDiff?: () => void;
  canViewDiff?: boolean;
  isAgentWorking?: boolean;
  /** Called when the user clicks "Fix errors" — receives all failing check runs */
  onFixChecks?: (failedRuns: PullRequestCheckRun[]) => Promise<void> | void;
  /** Called when the user clicks "Fix conflicts" — receives the base branch ref */
  onFixConflicts?: (baseBranchRef: string) => Promise<void> | void;
}

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

export function MergePrDialog({
  open,
  onOpenChange,
  session,
  onMerged,
  onViewDiff,
  canViewDiff = false,
  isAgentWorking = false,
  onFixChecks,
  onFixConflicts,
}: MergePrDialogProps) {
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
  const [emptyChecksPollCount, setEmptyChecksPollCount] = useState(0);

  const readinessRequestIdRef = useRef(0);
  const forceConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

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
    if (!open) {
      readinessRequestIdRef.current += 1;
      setError(null);
      setReadiness(null);
      setDeleteBranch(true);
      setMergeMethod("squash");
      setIsLoadingReadiness(false);
      setForceConfirming(false);
      setEmptyChecksPollCount(0);
      if (forceConfirmTimeoutRef.current) {
        clearTimeout(forceConfirmTimeoutRef.current);
        forceConfirmTimeoutRef.current = null;
      }
      return;
    }

    void loadReadiness();
  }, [open, loadReadiness]);

  useEffect(() => {
    if (
      !open ||
      isLoadingReadiness ||
      !shouldPollMergeReadiness({ readiness, emptyChecksPollCount })
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (
        readiness &&
        readiness.checks.pending === 0 &&
        readiness.checks.requiredTotal === 0 &&
        readiness.checkRuns.length === 0
      ) {
        setEmptyChecksPollCount((currentCount) => currentCount + 1);
      }
      void loadReadiness();
    }, MERGE_READINESS_POLL_INTERVAL_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    emptyChecksPollCount,
    isLoadingReadiness,
    loadReadiness,
    open,
    readiness,
  ]);

  const canMerge = readiness?.canMerge ?? false;
  const pullRequestUrl = readiness?.pr
    ? `https://github.com/${readiness.pr.repo}/pull/${readiness.pr.number}`
    : session.repoOwner && session.repoName && session.prNumber
      ? `https://github.com/${session.repoOwner}/${session.repoName}/pull/${session.prNumber}`
      : null;

  const openPullRequest = useCallback(() => {
    if (pullRequestUrl) {
      window.open(pullRequestUrl, "_blank", "noopener,noreferrer");
    }
  }, [pullRequestUrl]);

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

      await onMerged?.(mergeResult);

      onOpenChange(false);
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

  // Whether the user can bypass failing checks via force merge
  const canForce =
    readiness !== null &&
    !readiness.canMerge &&
    readiness.pr !== null &&
    !isLoadingReadiness &&
    nonBypassableReasons.length === 0;

  const handleForceClick = () => {
    if (forceConfirming) {
      // Second click – actually merge with force
      if (forceConfirmTimeoutRef.current) {
        clearTimeout(forceConfirmTimeoutRef.current);
        forceConfirmTimeoutRef.current = null;
      }
      setForceConfirming(false);
      void handleMerge(true);
    } else {
      // First click – enter confirmation state
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-5 w-5" />
            Merge & Archive
          </DialogTitle>
          <DialogDescription>
            Merge PR #{session.prNumber} and archive this session.
          </DialogDescription>
        </DialogHeader>

        <MergePrDialogActions
          canViewDiff={canViewDiff}
          canOpenPullRequest={Boolean(pullRequestUrl)}
          onOpenPullRequest={openPullRequest}
          onViewDiff={onViewDiff}
        />

        <div className="grid gap-4 py-2">
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
              <div className="space-y-3 py-3 pr-3 pl-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <p className="text-sm font-medium text-foreground">
                    Merge blocked
                  </p>
                </div>
                <div className="space-y-1.5 pl-6">
                  {nonBypassableReasons.map((reason) => (
                    <p
                      key={reason}
                      className="text-[13px] leading-snug text-muted-foreground"
                    >
                      {reason}
                    </p>
                  ))}
                  {hasMergeConflicts && (
                    <p className="text-xs leading-relaxed text-muted-foreground/80">
                      Fetch{" "}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground/70">
                        {baseBranchRef}
                      </code>
                      , resolve the conflicts, and avoid rebasing.
                    </p>
                  )}
                </div>
                {hasMergeConflicts && onFixConflicts && (
                  <div className="pl-6">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isAgentWorking}
                      onClick={() => {
                        void onFixConflicts(baseBranchRef);
                      }}
                    >
                      <Sparkles className="mr-2 h-3.5 w-3.5" />
                      Fix conflicts
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Delete source branch</p>
              <p className="text-xs text-muted-foreground">
                Deletes the PR branch after merge when possible.
              </p>
            </div>
            <Switch
              checked={deleteBranch}
              onCheckedChange={setDeleteBranch}
              disabled={isSubmitting || isInitialReadinessLoading}
            />
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          {canMerge ? (
            <div className="flex w-full sm:w-auto">
              <Button
                onClick={() => void handleMerge()}
                disabled={mergeDisabled}
                className={`min-w-0 flex-1 sm:flex-none${hasMultipleMethods ? " rounded-r-none" : ""}`}
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
                      className="rounded-l-none border-l border-l-primary-foreground/25"
                      disabled={mergeDisabled}
                      aria-label="Choose merge method"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72">
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
                          <span className="font-medium">
                            {mergeMethodLabels[method]}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {mergeMethodDescriptions[method]}
                          </span>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ) : (
            <Button
              variant="destructive"
              onClick={handleForceClick}
              disabled={
                isSubmitting || !readiness || !canForce || !readiness.pr
              }
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
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
