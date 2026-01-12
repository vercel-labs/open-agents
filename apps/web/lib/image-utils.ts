import type { FileUIPart } from "ai";

export type ImageMediaType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp";

export type ImageAttachment = {
  id: string;
  dataUrl: string;
  mediaType: ImageMediaType;
  filename?: string;
};

export const SUPPORTED_IMAGE_TYPES: ImageMediaType[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

export const ACCEPT_IMAGE_TYPES = SUPPORTED_IMAGE_TYPES.join(",");

export function isValidImageType(type: string): type is ImageMediaType {
  return SUPPORTED_IMAGE_TYPES.includes(type as ImageMediaType);
}

export function imageAttachmentToFilePart(image: ImageAttachment): FileUIPart {
  return {
    type: "file",
    filename: image.filename ?? `image-${image.id}.png`,
    mediaType: image.mediaType,
    url: image.dataUrl,
  };
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as string));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}
