"use client";

import { useState, useCallback } from "react";
import { nanoid } from "nanoid";
import {
  type TextAttachment,
  inferFilename,
} from "@/lib/text-attachment-utils";

export function useTextAttachments() {
  const [textAttachments, setTextAttachments] = useState<TextAttachment[]>([]);

  const addTextAttachment = useCallback(
    (text: string, filename?: string): TextAttachment => {
      const lineCount = text.split("\n").length;
      const byteSize = new Blob([text]).size;
      const attachment: TextAttachment = {
        id: nanoid(),
        content: text,
        filename: filename ?? inferFilename(text),
        lineCount,
        byteSize,
      };
      setTextAttachments((prev) => [...prev, attachment]);
      return attachment;
    },
    [],
  );

  const removeTextAttachment = useCallback((id: string) => {
    setTextAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearTextAttachments = useCallback(() => {
    setTextAttachments([]);
  }, []);

  return {
    textAttachments,
    addTextAttachment,
    removeTextAttachment,
    clearTextAttachments,
    hasTextAttachments: textAttachments.length > 0,
  };
}
