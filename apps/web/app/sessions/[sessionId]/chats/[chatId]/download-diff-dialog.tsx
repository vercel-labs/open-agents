"use client";

import { Check, Copy, Download, Loader2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type DownloadDiffDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDownload: () => Promise<void>;
  downloading: boolean;
  canDownload: boolean;
  filename: string;
};

export function DownloadDiffDialog({
  open,
  onOpenChange,
  onDownload,
  downloading,
  canDownload,
  filename,
}: DownloadDiffDialogProps) {
  const applyCommands = `# From a clean checkout of the target repository
git checkout main
git pull

git checkout -b apply-session-diff
git apply --check ~/Downloads/${filename}
git apply ~/Downloads/${filename}

# If the target branch has drifted, use a 3-way apply instead
git apply --3way ~/Downloads/${filename}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Download diff</DialogTitle>
          <DialogDescription>
            Download the patch file, then apply it in a local checkout of the
            same repository.
          </DialogDescription>
        </DialogHeader>

        <CommandBlock commands={applyCommands} />

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={downloading}
          >
            Close
          </Button>
          <Button onClick={onDownload} disabled={!canDownload || downloading}>
            {downloading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Downloading...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Download diff
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CommandBlock({ commands }: { commands: string }) {
  const { copied, copy } = useCopy();

  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-lg border bg-zinc-950 p-4 pr-12 font-mono text-xs leading-relaxed text-zinc-100 dark:bg-zinc-900">
        <code>{commands}</code>
      </pre>
      <button
        type="button"
        onClick={() => copy(commands)}
        aria-label={copied ? "Copied" : "Copy commands"}
        className={cn(
          "absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400",
          "transition-[color,background-color,transform] duration-150 ease-out",
          "hover:bg-zinc-800 hover:text-zinc-100 active:scale-95",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400",
        )}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

function useCopy() {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), 1600);
    });
  }, []);

  return { copied, copy };
}
