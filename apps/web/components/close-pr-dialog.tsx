"use client";

import { GitPullRequestClosed, Loader2 } from "lucide-react";
import { useState } from "react";
import type { ClosePullRequestResponse } from "@/app/api/sessions/[sessionId]/close-pr/route";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Session } from "@/lib/db/schema";

interface ClosePrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session;
  onClosed?: (result: ClosePullRequestResponse) => Promise<void> | void;
}

export function ClosePrDialog({
  open,
  onOpenChange,
  session,
  onClosed,
}: ClosePrDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/sessions/${session.id}/close-pr`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const payload = (await response.json()) as
        | ClosePullRequestResponse
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : "Failed to close pull request",
        );
      }

      const closeResult = payload as ClosePullRequestResponse;
      if (!closeResult.closed) {
        throw new Error("Failed to close pull request");
      }

      await onClosed?.(closeResult);

      onOpenChange(false);
    } catch (closeError) {
      setError(
        closeError instanceof Error
          ? closeError.message
          : "Failed to close pull request",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitPullRequestClosed className="h-5 w-5" />
            Close & Archive
          </DialogTitle>
          <DialogDescription>
            Close PR #{session.prNumber} and archive this session. This will not
            merge any changes.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Closing...
              </>
            ) : (
              "Confirm Close & Archive"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
