"use client";

import { Check, Loader2, GitMerge } from "lucide-react";
import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (!open) {
      setError(null);
      setReadiness(null);
      setDeleteBranch(true);
      setMergeMethod("squash");
      return;
    }

    let cancelled = false;

    const loadReadiness = async () => {
      setIsLoadingReadiness(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/sessions/${session.id}/merge-readiness`,
          {
            method: "GET",
          },
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

        if (cancelled) {
          return;
        }

        setReadiness(payload as MergeReadinessResponse);

        const preferredMethod = (payload as MergeReadinessResponse)
          .defaultMethod;
        setMergeMethod(preferredMethod);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load merge readiness",
        );
      } finally {
        if (!cancelled) {
          setIsLoadingReadiness(false);
        }
      }
    };

    void loadReadiness();

    return () => {
      cancelled = true;
    };
  }, [open, session.id]);

  const canMerge = readiness?.canMerge ?? false;

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

      if (onMerged) {
        await onMerged(mergeResult);
      }

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
