import type { FileUIPart } from "ai";
import type { ImageMediaType } from "./image-clipboard.js";

export type ImageBlock = {
  id: number;
  dataUrl: string;
  mediaType: ImageMediaType;
};

export function formatImagePlaceholder(id: number): string {
  return `[Image #${id}]`;
}

export function imageBlockToFilePart(block: ImageBlock): FileUIPart {
  return {
    type: "file",
    filename: `image-${block.id}.png`,
    mediaType: block.mediaType,
    url: block.dataUrl,
  };
}
