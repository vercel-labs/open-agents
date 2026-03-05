"use client";

import { PatchDiff } from "@pierre/diffs/react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { DiffFile } from "@/app/api/sessions/[sessionId]/diff/route";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type DiffMode,
  useUserPreferences,
} from "@/hooks/use-user-preferences";
import { useIsMobile } from "@/hooks/use-mobile";
import { defaultDiffOptions, splitDiffOptions } from "@/lib/diffs-config";
import { cn } from "@/lib/utils";
import { useSessionChatContext } from "./session-chat-context";

type DiffViewerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type DiffStyle = DiffMode;

function formatTimestamp(date: Date) {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StaleBanner({ cachedAt }: { cachedAt: Date | null }) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-amber-100 px-4 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
      <span>
        Viewing cached changes - sandbox is offline
        {cachedAt && (
          <span className="text-amber-700/70 dark:text-amber-400/70">
            {" "}
            (saved {formatTimestamp(cachedAt)})
          </span>
        )}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: DiffFile["status"] }) {
  const styles = {
    added: "bg-green-500/20 text-green-700 dark:text-green-400",
    modified: "bg-blue-500/20 text-blue-700 dark:text-blue-400",
    deleted: "bg-red-500/20 text-red-700 dark:text-red-400",
    renamed: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400",
  };

  const labels = {
    added: "New",
    modified: "Modified",
    deleted: "Deleted",
    renamed: "Renamed",
  };

  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
        styles[status],
      )}
    >
      {labels[status]}
    </span>
  );
}

function StagingBadge({
  stagingStatus,
}: {
  stagingStatus: DiffFile["stagingStatus"];
}) {
  if (!stagingStatus || stagingStatus === "staged") return null;

  const styles = {
    unstaged: "bg-orange-500/20 text-orange-700 dark:text-orange-400",
    partial: "bg-purple-500/20 text-purple-700 dark:text-purple-400",
  };

  const labels = {
    unstaged: "Unstaged",
    partial: "Partial",
  };

  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
        styles[stagingStatus],
      )}
    >
      {labels[stagingStatus]}
    </span>
  );
}

function FileEntry({
  file,
  isExpanded,
  onToggle,
  diffStyle,
}: {
  file: DiffFile;
  isExpanded: boolean;
  onToggle: () => void;
  diffStyle: DiffStyle;
}) {
  const fileName = file.path.split("/").pop() ?? file.path;
  const dirPath = file.path.slice(0, -fileName.length);
  const options = diffStyle === "split" ? splitDiffOptions : defaultDiffOptions;
  const isGenerated = file.generated === true;

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={isGenerated ? undefined : onToggle}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left",
          isGenerated ? "cursor-default opacity-70" : "hover:bg-muted/50",
        )}
      >
        {isGenerated ? (
          <span className="h-4 w-4 shrink-0" />
        ) : isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm">
            {dirPath && (
              <span className="text-muted-foreground">{dirPath}</span>
            )}
            <span className="font-medium text-foreground">{fileName}</span>
          </span>
          <StatusBadge status={file.status} />
          <StagingBadge stagingStatus={file.stagingStatus} />
          {isGenerated && (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground bg-muted">
              Generated
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs">
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

      {isExpanded && !isGenerated && (
        <div className="border-t border-border">
          {file.diff ? (
            <PatchDiff key={diffStyle} patch={file.diff} options={options} />
          ) : (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              No diff content available
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DiffViewer({ open, onOpenChange }: DiffViewerProps) {
  const {
    diff,
    diffLoading,
    diffRefreshing,
    diffError,
    diffCachedAt,
    sandboxInfo,
    refreshDiff,
  } = useSessionChatContext();
  const isMobile = useIsMobile();
  const { preferences } = useUserPreferences();
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [diffStyle, setDiffStyle] = useState<DiffStyle>("unified");

  // Show stale indicator if sandbox is offline (even if data came from a live fetch earlier)
  const showStaleIndicator = !sandboxInfo && diff !== null;

  const toggleFile = (path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const expandAll = () => {
    if (diff) {
      setExpandedFiles(new Set(diff.files.map((f) => f.path)));
    }
  };

  const collapseAll = () => {
    setExpandedFiles(new Set());
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    if (isMobile) {
      setDiffStyle("unified");
      return;
    }

    setDiffStyle(preferences?.defaultDiffMode ?? "unified");
  }, [open, isMobile, preferences?.defaultDiffMode]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex h-[90vh] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[calc(100vw-4rem)]"
      >
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3">
          <div className="flex items-center justify-between pr-8">
            <div className="flex items-center gap-3">
              <DialogTitle className="text-base font-medium">
                Changes
              </DialogTitle>
              {diff && diff.summary.totalFiles > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-green-600 dark:text-green-500">
                    +{diff.summary.totalAdditions}
                  </span>
                  <span className="text-red-600 dark:text-red-400">
                    -{diff.summary.totalDeletions}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refreshDiff()}
                disabled={diffRefreshing || !sandboxInfo}
                className="h-7 px-2 text-xs"
                title="Refresh diff"
              >
                <RefreshCw
                  className={cn("h-3 w-3", diffRefreshing && "animate-spin")}
                />
              </Button>
              {/* Unified / Split toggle - hidden on mobile, unified forced */}
              <div className="hidden items-center rounded-md border border-border md:flex">
                <button
                  type="button"
                  onClick={() => setDiffStyle("unified")}
                  className={cn(
                    "rounded-l-md px-2.5 py-1 text-xs font-medium transition-colors",
                    diffStyle === "unified"
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Unified
                </button>
                <button
                  type="button"
                  onClick={() => setDiffStyle("split")}
                  className={cn(
                    "rounded-r-md px-2.5 py-1 text-xs font-medium transition-colors",
                    diffStyle === "split"
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Split
                </button>
              </div>
              {diff && diff.files.length > 0 && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={expandAll}
                    className="h-7 px-2 text-xs"
                  >
                    Expand all
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={collapseAll}
                    className="h-7 px-2 text-xs"
                  >
                    Collapse
                  </Button>
                </>
              )}
            </div>
          </div>
          <DialogDescription className="sr-only">
            File changes diff viewer
          </DialogDescription>
        </DialogHeader>

        {/* Staleness indicator */}
        {showStaleIndicator ? <StaleBanner cachedAt={diffCachedAt} /> : null}

        {/* Content */}
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            showStaleIndicator && "opacity-90",
          )}
        >
          {diffLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {diffError && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-red-600 dark:text-red-400">
                {diffError}
              </p>
            </div>
          )}

          {!diffLoading && !diffError && diff && diff.files.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No changes detected
              </p>
            </div>
          )}

          {!diffLoading && !diffError && diff && diff.files.length > 0 && (
            <div>
              {diff.files.map((file) => (
                <FileEntry
                  key={file.path}
                  file={file}
                  isExpanded={expandedFiles.has(file.path)}
                  onToggle={() => toggleFile(file.path)}
                  diffStyle={diffStyle}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer with file count and base ref */}
        {diff && diff.files.length > 0 && (
          <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
            <span>
              {diff.summary.totalFiles} file
              {diff.summary.totalFiles !== 1 && "s"} changed
            </span>
            {diff.baseRef && (
              <span>
                vs{" "}
                <span className="font-mono text-foreground/70">
                  {diff.baseRef}
                </span>
              </span>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
