"use client";

import {
  AlertTriangle,
  Check,
  ExternalLink,
  GitMerge,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MergeReadinessResponse } from "@/app/api/sessions/[sessionId]/merge-readiness/route";
import type { MergePullRequestResponse } from "@/app/api/sessions/[sessionId]/merge/route";
import type { Session } from "@/lib/db/schema";
import type { PullRequestMergeMethod } from "@/lib/github/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CheckRunsList } from "@/components/merge-check-runs";
import { MergePrDialogActions } from "@/components/merge-pr-dialog-actions";

interface MergePrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session;
  onMerged?: (result: MergePullRequestResponse) => Promise<void> | void;
  onViewDiff?: () => void;
  canViewDiff?: boolean;
}

const mergeMethodLabels: Record<PullRequestMergeMethod, string> = {
  squash: "Squash",
  merge: "Merge commit",
  rebase: "Rebase",
};

function formatMergeMethodLabel(method: PullRequestMergeMethod): string {
  return mergeMethodLabels[method] ?? method;
}

export function MergePrDialog({
  open,
  onOpenChange,
  session,
  onMerged,
  onViewDiff,
  canViewDiff = false,
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

  useEffect(() => {
    if (!open) {
      readinessRequestIdRef.current += 1;
      setError(null);
      setReadiness(null);
      setDeleteBranch(true);
      setMergeMethod("squash");
      setIsLoadingReadiness(false);
      setForceConfirming(false);
      if (forceConfirmTimeoutRef.current) {
        clearTimeout(forceConfirmTimeoutRef.current);
        forceConfirmTimeoutRef.current = null;
      }
      return;
    }

    void loadReadiness();
  }, [open, loadReadiness]);

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

  // Whether the user can bypass failing checks via force merge
  const canForce =
    readiness !== null &&
    !readiness.canMerge &&
    readiness.pr !== null &&
    !isLoadingReadiness;

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

  const hasReadinessWarning =
    readiness !== null &&
    !readiness.canMerge &&
    readiness.reasons.length > 0 &&
    !error;

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
          isLoadingReadiness={isLoadingReadiness}
          isSubmitting={isSubmitting}
          onOpenPullRequest={openPullRequest}
          onRefresh={() => {
            void loadReadiness();
          }}
          onViewDiff={onViewDiff}
        />

        <div className="grid gap-4 py-2">
          {isLoadingReadiness ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking merge readiness...
            </div>
          ) : (
            <>
              {readiness?.checks.requiredTotal ? (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                  Checks: {readiness.checks.passed} passed,{" "}
                  {readiness.checks.pending} pending, {readiness.checks.failed}{" "}
                  failing
                </div>
              ) : null}

              {readiness?.checkRuns.length ? (
                <CheckRunsList checkRuns={readiness.checkRuns} />
              ) : null}

              <div className="grid gap-2">
                <Label htmlFor="merge-method">Merge method</Label>
                <Select
                  value={mergeMethod}
                  onValueChange={(value) => {
                    if (
                      value === "merge" ||
                      value === "squash" ||
                      value === "rebase"
                    ) {
                      setMergeMethod(value);
                    }
                  }}
                  disabled={
                    isSubmitting ||
                    isLoadingReadiness ||
                    !readiness ||
                    readiness.allowedMethods.length === 0
                  }
                >
                  <SelectTrigger id="merge-method" className="w-full">
                    <SelectValue placeholder="Select merge method" />
                  </SelectTrigger>
                  <SelectContent>
                    {(readiness?.allowedMethods ?? ["squash"]).map((method) => (
                      <SelectItem key={method} value={method}>
                        {formatMergeMethodLabel(method)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

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
                  disabled={isSubmitting || isLoadingReadiness}
                />
              </div>

              {hasReadinessWarning && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                  <p className="font-medium">
                    This pull request is not ready to merge:
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {readiness.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  {readiness.checkRuns.length > 0 &&
                    readiness.checkRuns.some((cr) => cr.state !== "passed") && (
                      <div className="mt-2 border-t border-amber-500/20 pt-2">
                        <ul className="space-y-1">
                          {readiness.checkRuns
                            .filter((cr) => cr.state !== "passed")
                            .map((cr, i) => (
                              <li
                                key={`${cr.name}-${i}`}
                                className="flex items-center gap-1.5"
                              >
                                {cr.state === "pending" ? (
                                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                                ) : (
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                )}
                                <span className="truncate">{cr.name}</span>
                                {cr.detailsUrl && (
                                  /* oxlint-disable-next-line nextjs/no-html-link-for-pages */
                                  <a
                                    href={cr.detailsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ml-auto shrink-0 underline underline-offset-2 opacity-70 hover:opacity-100"
                                    aria-label={`View details for ${cr.name}`}
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </li>
                            ))}
                        </ul>
                      </div>
                    )}
                </div>
              )}
            </>
          )}

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
            <Button
              onClick={() => void handleMerge()}
              disabled={
                isSubmitting ||
                isLoadingReadiness ||
                !readiness ||
                !readiness.pr
              }
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Merging...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Confirm Merge & Archive
                </>
              )}
            </Button>
          ) : (
            <Button
              variant="destructive"
              onClick={handleForceClick}
              disabled={
                isSubmitting ||
                isLoadingReadiness ||
                !readiness ||
                !canForce ||
                !readiness.pr
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
