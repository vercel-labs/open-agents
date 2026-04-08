"use client";

import { useState } from "react";
import { FileText, X } from "lucide-react";
import type { TextAttachment } from "@/lib/text-attachment-utils";
import { formatByteSize } from "@/lib/text-attachment-utils";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface TextAttachmentChipProps {
  attachment: TextAttachment;
  onRemove: () => void;
  onPreview: () => void;
}

function TextAttachmentChip({
  attachment,
  onRemove,
  onPreview,
}: TextAttachmentChipProps) {
  const meta = `${attachment.lineCount} lines · ${formatByteSize(attachment.byteSize)}`;

  return (
    <div className="group relative min-w-0 max-w-full p-1">
      <button
        type="button"
        onClick={onPreview}
        className={cn(
          "flex max-w-full items-center gap-2 rounded-lg border border-border/60 bg-muted/60 px-3 py-2",
          "text-left font-mono text-sm leading-tight text-foreground",
          "transition-colors hover:border-foreground/20 hover:bg-muted",
        )}
      >
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate">{attachment.filename}</span>
          <span className="truncate text-[11px] text-muted-foreground">
            {meta}
          </span>
        </div>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-700 text-neutral-300 opacity-0 transition-opacity hover:bg-neutral-600 group-hover:opacity-100"
        aria-label="Remove text attachment"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

interface TextAttachmentPreviewDialogProps {
  attachment: TextAttachment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function TextAttachmentPreviewDialog({
  attachment,
  open,
  onOpenChange,
}: TextAttachmentPreviewDialogProps) {
  if (!attachment) return null;

  const meta = `${attachment.lineCount} lines · ${formatByteSize(attachment.byteSize)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-sm">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span>{attachment.filename}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {meta}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/40 p-4">
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
            {attachment.content}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface TextAttachmentsPreviewProps {
  attachments: TextAttachment[];
  onRemove: (id: string) => void;
  className?: string;
}

export function TextAttachmentsPreview({
  attachments,
  onRemove,
  className,
}: TextAttachmentsPreviewProps) {
  const [previewAttachment, setPreviewAttachment] =
    useState<TextAttachment | null>(null);

  if (attachments.length === 0) return null;

  return (
    <>
      <div className={cn("flex min-w-0 flex-wrap gap-1", className)}>
        {attachments.map((attachment) => (
          <TextAttachmentChip
            key={attachment.id}
            attachment={attachment}
            onRemove={() => onRemove(attachment.id)}
            onPreview={() => setPreviewAttachment(attachment)}
          />
        ))}
      </div>
      <TextAttachmentPreviewDialog
        attachment={previewAttachment}
        open={previewAttachment !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewAttachment(null);
        }}
      />
    </>
  );
}
