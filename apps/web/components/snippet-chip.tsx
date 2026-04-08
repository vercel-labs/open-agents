"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SnippetChipProps {
  filename: string;
  content: string;
  className?: string;
}

export function SnippetChip({
  filename,
  content,
  className,
}: SnippetChipProps) {
  const [open, setOpen] = useState(false);
  const lineCount = content.split("\n").length;
  const byteSize = new Blob([content]).size;
  const meta = `${lineCount} lines · ${formatBytes(byteSize)}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex max-w-full items-center gap-2 rounded-2xl bg-secondary px-4 py-2",
          "font-mono text-sm leading-tight text-foreground",
          "transition-colors hover:bg-secondary/80",
          className,
        )}
        title={`${filename}\n${meta}`}
      >
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{filename}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {meta}
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-mono text-sm">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{filename}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {meta}
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/40 p-4">
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
              {content}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
