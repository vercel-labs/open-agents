"use client";

import { X } from "lucide-react";
import type { ImageAttachment } from "@/lib/image-utils";
import { cn } from "@/lib/utils";

interface ImageAttachmentItemProps {
  image: ImageAttachment;
  onRemove: () => void;
}

function ImageAttachmentItem({ image, onRemove }: ImageAttachmentItemProps) {
  return (
    <div className="group relative flex-shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element -- Data URLs not supported by next/image */}
      <img
        src={image.dataUrl}
        alt={image.filename ?? "Attached image"}
        className="h-16 w-16 rounded-lg object-cover"
      />
      <button
        type="button"
        onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-700 text-neutral-300 opacity-0 transition-opacity hover:bg-neutral-600 group-hover:opacity-100"
        aria-label="Remove image"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

interface ImageAttachmentsPreviewProps {
  images: ImageAttachment[];
  onRemove: (id: string) => void;
  className?: string;
}

export function ImageAttachmentsPreview({
  images,
  onRemove,
  className,
}: ImageAttachmentsPreviewProps) {
  if (images.length === 0) return null;

  return (
    <div className={cn("flex gap-2 overflow-x-auto px-3 pb-2 pt-3", className)}>
      {images.map((image) => (
        <ImageAttachmentItem
          key={image.id}
          image={image}
          onRemove={() => onRemove(image.id)}
        />
      ))}
    </div>
  );
}
