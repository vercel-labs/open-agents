"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, X, FileText, Loader2 } from "lucide-react";
import { PatchDiff } from "@pierre/diffs/react";
import { cn } from "@/lib/utils";
import { defaultDiffOptions } from "@/lib/diffs-config";
import { Button } from "@/components/ui/button";
import type { DiffFile } from "@/app/api/sessions/[sessionId]/diff/route";
import { useSessionChatContext } from "./session-chat-context";

type DiffViewerProps = {
  onClose: () => void;
};

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
    <div className="flex items-center gap-2 border-b border-border bg-amber-950/30 px-4 py-2 text-xs text-amber-400">
      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
      <span>
        Viewing cached changes - sandbox is offline
        {cachedAt && (
          <span className="text-amber-400/70">
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
    added: "bg-green-500/20 text-green-400",
    modified: "bg-blue-500/20 text-blue-400",
    deleted: "bg-red-500/20 text-red-400",
    renamed: "bg-yellow-500/20 text-yellow-400",
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

function FileEntry({
  file,
  isExpanded,
  onToggle,
}: {
  file: DiffFile;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const fileName = file.path.split("/").pop() ?? file.path;
  const dirPath = file.path.slice(0, -fileName.length);

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
      >
        {isExpanded ? (
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
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs">
          {file.additions > 0 && (
            <span className="text-green-500">+{file.additions}</span>
          )}
          {file.deletions > 0 && (
            <span className="text-red-400">-{file.deletions}</span>
          )}
        </div>
      </button>

      {isExpanded && file.diff && (
        <div className="border-t border-border">
          <PatchDiff patch={file.diff} options={defaultDiffOptions} />
        </div>
      )}
    </div>
  );
}

export function DiffViewer({ onClose }: DiffViewerProps) {
  const { diff, diffLoading, diffError, diffCachedAt, sandboxInfo } =
    useSessionChatContext();
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

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

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-card md:relative md:inset-auto md:z-auto md:h-full md:w-[500px] md:min-w-0 md:border-l md:border-border">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <h2 className="font-medium text-foreground">Changes</h2>
          {diff && diff.summary.totalFiles > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-green-500">
                +{diff.summary.totalAdditions}
              </span>
              <span className="text-red-400">
                -{diff.summary.totalDeletions}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
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
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-7 w-7"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Staleness indicator */}
      {showStaleIndicator && <StaleBanner cachedAt={diffCachedAt} />}

      {/* Content */}
      <div
        className={cn(
          "flex-1 overflow-y-auto",
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
            <p className="text-sm text-red-400">{diffError}</p>
          </div>
        )}

        {!diffLoading && !diffError && diff && diff.files.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">No changes detected</p>
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
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer with file count */}
      {diff && diff.files.length > 0 && (
        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          {diff.summary.totalFiles} file{diff.summary.totalFiles !== 1 && "s"}{" "}
          changed
        </div>
      )}
    </div>
  );
}
