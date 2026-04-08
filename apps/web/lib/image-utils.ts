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

const COMPRESSED_IMAGE_MEDIA_TYPE = "image/webp";
const COMPRESSED_IMAGE_QUALITY = 0.75;
const MAX_IMAGE_DIMENSION = 1600;

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
    filename:
      image.filename ?? `image-${image.id}.${image.mediaType.split("/")[1]}`,
    mediaType: image.mediaType,
    url: image.dataUrl,
  };
}

export async function compressImageFile(file: File): Promise<File> {
  if (!isValidImageType(file.type) || file.type === "image/gif") {
    return file;
  }

  const image = await loadImageElement(file);
  const { width, height } = getCompressedImageDimensions({
    width: image.naturalWidth,
    height: image.naturalHeight,
  });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to create image compression context");
  }

  context.drawImage(image, 0, 0, width, height);

  const blob = await canvasToBlob(
    canvas,
    COMPRESSED_IMAGE_MEDIA_TYPE,
    COMPRESSED_IMAGE_QUALITY,
  );

  if (!isValidImageType(blob.type) || blob.size >= file.size) {
    return file;
  }

  return new File([blob], replaceFileExtension(file.name, blob.type), {
    type: blob.type,
    lastModified: file.lastModified,
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as string));
    reader.addEventListener("error", () => reject(reader.error));
    reader.addEventListener("abort", () =>
      reject(new Error("File read aborted")),
    );
    reader.readAsDataURL(file);
  });
}

type ImageDimensions = {
  width: number;
  height: number;
};

function getCompressedImageDimensions({
  width,
  height,
}: ImageDimensions): ImageDimensions {
  const longestSide = Math.max(width, height);

  if (longestSide <= MAX_IMAGE_DIMENSION) {
    return { width, height };
  }

  const scale = MAX_IMAGE_DIMENSION / longestSide;

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function replaceFileExtension(
  filename: string,
  mediaType: ImageMediaType,
): string {
  const extension = mediaType.split("/")[1];
  const lastDotIndex = filename.lastIndexOf(".");

  if (lastDotIndex === -1) {
    return `${filename}.${extension}`;
  }

  return `${filename.slice(0, lastDotIndex)}.${extension}`;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mediaType: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to compress image"));
          return;
        }

        resolve(blob);
      },
      mediaType,
      quality,
    );
  });
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.addEventListener("load", () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    });
    image.addEventListener("error", () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image"));
    });

    image.src = objectUrl;
  });
}
