import { ExternalLink, GitCompare, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type MergePrDialogActionsProps = {
  canViewDiff: boolean;
  canOpenPullRequest: boolean;
  isLoadingReadiness: boolean;
  isSubmitting: boolean;
  onOpenPullRequest: () => void;
  onRefresh: () => void;
  onViewDiff?: () => void;
};

export function MergePrDialogActions({
  canViewDiff,
  canOpenPullRequest,
  isLoadingReadiness,
  isSubmitting,
  onOpenPullRequest,
  onRefresh,
  onViewDiff,
}: MergePrDialogActionsProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onOpenPullRequest}
          disabled={!canOpenPullRequest}
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          View PR
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onViewDiff}
          disabled={!canViewDiff || !onViewDiff}
        >
          <GitCompare className="mr-2 h-4 w-4" />
          View Diff
        </Button>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        disabled={isLoadingReadiness || isSubmitting}
      >
        <RefreshCw
          className={`mr-2 h-4 w-4 ${isLoadingReadiness ? "animate-spin" : ""}`}
        />
        Refresh status
      </Button>
    </div>
  );
}
