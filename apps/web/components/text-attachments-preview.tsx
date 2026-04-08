"use client";

import { FileText, X } from "lucide-react";
import type { TextAttachment } from "@/lib/text-attachment-utils";
import { formatByteSize } from "@/lib/text-attachment-utils";
import { cn } from "@/lib/utils";

interface TextAttachmentChipProps {
  attachment: TextAttachment;
  onRemove: () => void;
}

function TextAttachmentChip({ attachment, onRemove }: TextAttachmentChipProps) {
  const meta = `${attachment.lineCount} lines · ${formatByteSize(attachment.byteSize)}`;

  return (
    <div className="group relative flex-shrink-0">
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border/60 bg-muted/60 px-3 py-2",
          "font-mono text-sm leading-tight text-foreground",
        )}
        title={`${attachment.filename}\n${meta}`}
      >
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate">{attachment.filename}</span>
          <span className="text-[11px] text-muted-foreground">{meta}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-700 text-neutral-300 opacity-0 transition-opacity hover:bg-neutral-600 group-hover:opacity-100"
        aria-label="Remove text attachment"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
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
  if (attachments.length === 0) return null;

  return (
    <div className={cn("flex gap-2 overflow-x-auto px-3 pb-2 pt-3", className)}>
      {attachments.map((attachment) => (
        <TextAttachmentChip
          key={attachment.id}
          attachment={attachment}
          onRemove={() => onRemove(attachment.id)}
        />
      ))}
    </div>
  );
}
