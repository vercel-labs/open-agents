"use client";

import { useState, useCallback, useRef } from "react";
import type { FileUIPart } from "ai";
import { nanoid } from "nanoid";
import {
  type ImageAttachment,
  type ImageMediaType,
  imageAttachmentToFilePart,
  fileToDataUrl,
  isValidImageType,
} from "@/lib/image-utils";

export function useImageAttachments() {
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addImage = useCallback(async (file: File) => {
    if (!isValidImageType(file.type)) return false;

    const dataUrl = await fileToDataUrl(file);
    const attachment: ImageAttachment = {
      id: nanoid(),
      dataUrl,
      mediaType: file.type as ImageMediaType,
      filename: file.name,
    };
    setImages((prev) => [...prev, attachment]);
    return true;
  }, []);

  const addImages = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      await Promise.all(fileArray.map(addImage));
    },
    [addImage],
  );

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const clearImages = useCallback(() => {
    setImages([]);
  }, []);

  const getFileParts = useCallback((): FileUIPart[] | undefined => {
    return images.length > 0
      ? images.map(imageAttachmentToFilePart)
      : undefined;
  }, [images]);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const addImageAttachments = useCallback((attachments: ImageAttachment[]) => {
    setImages((prev) => [...prev, ...attachments]);
  }, []);

  return {
    images,
    addImage,
    addImages,
    removeImage,
    clearImages,
    getFileParts,
    fileInputRef,
    openFilePicker,
    addImageAttachments,
    hasImages: images.length > 0,
  };
}
