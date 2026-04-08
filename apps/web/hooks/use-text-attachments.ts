"use client";

import { useState, useCallback } from "react";
import type { FileUIPart } from "ai";
import { nanoid } from "nanoid";
import {
  type TextAttachment,
  inferFilename,
  textAttachmentToFilePart,
} from "@/lib/text-attachment-utils";

export function useTextAttachments() {
  const [textAttachments, setTextAttachments] = useState<TextAttachment[]>([]);

  const addTextAttachment = useCallback((text: string): TextAttachment => {
    const lineCount = text.split("\n").length;
    const byteSize = new Blob([text]).size;
    const attachment: TextAttachment = {
      id: nanoid(),
      content: text,
      filename: inferFilename(text),
      lineCount,
      byteSize,
    };
    setTextAttachments((prev) => [...prev, attachment]);
    return attachment;
  }, []);

  const removeTextAttachment = useCallback((id: string) => {
    setTextAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearTextAttachments = useCallback(() => {
    setTextAttachments([]);
  }, []);

  const getTextFileParts = useCallback((): FileUIPart[] | undefined => {
    return textAttachments.length > 0
      ? textAttachments.map(textAttachmentToFilePart)
      : undefined;
  }, [textAttachments]);

  return {
    textAttachments,
    addTextAttachment,
    removeTextAttachment,
    clearTextAttachments,
    getTextFileParts,
    hasTextAttachments: textAttachments.length > 0,
  };
}
