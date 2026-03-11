"use client";

import {
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  GitMerge,
  Loader2,
  RefreshCw,
  XCircle,
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

interface MergePrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session;
  onMerged?: (result: MergePullRequestResponse) => Promise<void> | void;
}

const mergeMethodLabels: Record<PullRequestMergeMethod, string> = {
  squash: "Squash",
  merge: "Merge commit",
  rebase: "Rebase",
};

function formatMergeMethodLabel(method: PullRequestMergeMethod): string {
  return mergeMethodLabels[method] ?? method;
}

function getCheckStateLabel(state: "passed" | "pending" | "failed"): string {
  return state === "passed"
    ? "Passed"
    : state === "pending"
      ? "Pending"
      : "Failing";
}

export function MergePrDialog({
  open,
  onOpenChange,
  session,
  onMerged,
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

  const readinessRequestIdRef = useRef(0);

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

  const handleMerge = async () => {
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

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openPullRequest}
            disabled={!pullRequestUrl}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            View PR
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              void loadReadiness();
            }}
            disabled={isLoadingReadiness || isSubmitting}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${isLoadingReadiness ? "animate-spin" : ""}`}
            />
            Refresh status
          </Button>
        </div>

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
                <div className="rounded-md border border-border bg-muted/40 p-3">
                  <p className="mb-2 text-sm font-medium text-foreground">
                    Check details
                  </p>
                  <ul className="max-h-40 space-y-1 overflow-y-auto">
                    {readiness.checkRuns.map((checkRun, index) => (
                      <li
                        key={`${checkRun.name}-${checkRun.detailsUrl ?? "no-url"}-${index}`}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          {checkRun.state === "passed" ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
                          ) : checkRun.state === "pending" ? (
                            <Clock3 className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
                          ) : (
                            <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                          )}
                          <span className="truncate text-foreground">
                            {checkRun.name}
                          </span>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <span
                            className={
                              checkRun.state === "passed"
                                ? "text-xs text-emerald-600 dark:text-emerald-500"
                                : checkRun.state === "pending"
                                  ? "text-xs text-amber-600 dark:text-amber-500"
                                  : "text-xs text-destructive"
                            }
                          >
                            {getCheckStateLabel(checkRun.state)}
                          </span>
                          {checkRun.detailsUrl ? (
                            /* External link to GitHub check details */
                            /* oxlint-disable-next-line nextjs/no-html-link-for-pages */
                            <a
                              href={checkRun.detailsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted-foreground hover:text-foreground"
                              aria-label={`Open details for ${checkRun.name}`}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
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
          <Button
            onClick={handleMerge}
            disabled={
              isSubmitting ||
              isLoadingReadiness ||
              !readiness ||
              !canMerge ||
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
