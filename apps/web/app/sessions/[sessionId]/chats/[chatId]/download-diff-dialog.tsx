"use client";

import { Download, Loader2, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  const applyDiffCommands = `# From a clean checkout of the target repository
git checkout main
git pull

git checkout -b apply-session-diff
git apply --check ~/Downloads/${filename}
git apply ~/Downloads/${filename}`;

  const threeWayCommand = `# If the target branch has drifted
git apply --3way ~/Downloads/${filename}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Download diff
          </DialogTitle>
          <DialogDescription>
            Download a patch file for these session changes, then apply it in a
            local checkout of the same repository.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-md border bg-background p-1.5">
                <Download className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <p className="font-medium text-sm">Download this diff</p>
                <p className="text-muted-foreground text-sm">
                  The file includes committed, staged, unstaged, and readable
                  untracked changes from the session.
                </p>
                <p className="text-muted-foreground text-sm">
                  It will download as{" "}
                  <code className="rounded border bg-background px-1.5 py-0.5 font-mono text-foreground text-xs">
                    {filename}
                  </code>
                  .
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Terminal className="h-4 w-4 text-muted-foreground" />
              Apply it locally
            </div>
            <pre className="overflow-x-auto rounded-lg border bg-zinc-950 p-4 text-zinc-100 text-xs leading-relaxed dark:bg-zinc-900">
              <code>{applyDiffCommands}</code>
            </pre>
          </div>

          <div className="space-y-2">
            <p className="text-muted-foreground text-sm">
              If the target branch moved since the session started, try a 3-way
              apply:
            </p>
            <pre className="overflow-x-auto rounded-lg border bg-muted p-3 text-xs leading-relaxed">
              <code>{threeWayCommand}</code>
            </pre>
          </div>

          <p className="text-muted-foreground text-xs">
            Apply from a clean checkout. Binary or unreadable untracked files
            may not be included in the diff.
          </p>
        </div>

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
