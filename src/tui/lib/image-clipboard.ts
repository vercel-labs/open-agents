import { $ } from "bun";

export type ImageMediaType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp";

export type ClipboardImage = {
  data: Buffer;
  mediaType: ImageMediaType;
};

const IMAGE_EXTENSIONS: Record<string, ImageMediaType> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export function isImagePath(path: string): boolean {
  // Clean up: remove quotes, unescape backslash-escaped spaces
  const cleaned = path
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\ /g, " ")
    .toLowerCase();
  return Object.keys(IMAGE_EXTENSIONS).some((ext) => cleaned.endsWith(ext));
}

export function getImageMediaType(path: string): ImageMediaType | null {
  const lower = path.toLowerCase().trim();
  for (const [ext, mediaType] of Object.entries(IMAGE_EXTENSIONS)) {
    if (lower.endsWith(ext)) {
      return mediaType;
    }
  }
  return null;
}

export async function loadImageFromPath(
  filePath: string,
): Promise<ClipboardImage | null> {
  try {
    // Clean up: remove quotes, unescape backslash-escaped spaces
    const cleanPath = filePath
      .trim()
      .replace(/^['"]|['"]$/g, "")
      .replace(/\\ /g, " ");
    const file = Bun.file(cleanPath);
    const exists = await file.exists();
    if (!exists) return null;

    const mediaType = getImageMediaType(cleanPath);
    if (!mediaType) return null;

    const data = Buffer.from(await file.arrayBuffer());
    return { data, mediaType };
  } catch {
    return null;
  }
}

export async function getClipboardImage(): Promise<ClipboardImage | null> {
  if (process.platform === "darwin") {
    return getClipboardImageMacOS();
  }
  if (process.platform === "linux") {
    return getClipboardImageLinux();
  }
  return null;
}

async function getClipboardImageMacOS(): Promise<ClipboardImage | null> {
  try {
    const result = await $`osascript -e 'clipboard info' 2>/dev/null`.text();
    if (
      !result.includes("«class PNGf»") &&
      !result.includes("JPEG picture") &&
      !result.includes("GIF picture")
    ) {
      return null;
    }

    const pngData =
      await $`osascript -e 'the clipboard as «class PNGf»' 2>/dev/null | sed 's/«data PNGf//; s/»//' | xxd -r -p`.arrayBuffer();

    if (pngData.byteLength === 0) {
      return null;
    }

    return {
      data: Buffer.from(pngData),
      mediaType: "image/png",
    };
  } catch {
    return null;
  }
}

async function getClipboardImageLinux(): Promise<ClipboardImage | null> {
  try {
    const pngData =
      await $`xclip -selection clipboard -t image/png -o 2>/dev/null`.arrayBuffer();

    if (pngData.byteLength === 0) {
      return null;
    }

    return {
      data: Buffer.from(pngData),
      mediaType: "image/png",
    };
  } catch {
    return null;
  }
}

export function imageToDataUrl(image: ClipboardImage): string {
  const base64 = image.data.toString("base64");
  return `data:${image.mediaType};base64,${base64}`;
}
