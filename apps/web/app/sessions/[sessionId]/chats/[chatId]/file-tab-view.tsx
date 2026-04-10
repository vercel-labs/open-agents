"use client";

import { File as DiffsFile } from "@pierre/diffs/react";
import { FileText, Loader2, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import useSWR from "swr";
import type { WorkspaceFileContentResponse } from "@/app/api/sessions/[sessionId]/files/content/route";
import { useGitPanel } from "./git-panel-context";
import { useSessionChatMetadataContext } from "./session-chat-context";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { defaultFileOptions } from "@/lib/diffs-config";
import { fetcherNoStore } from "@/lib/swr";
import { cn } from "@/lib/utils";

const wrappedFileExtensions = new Set([".md", ".mdx", ".markdown", ".txt"]);

function shouldWrapFileContent(filePath: string) {
  const normalizedPath = filePath.toLowerCase();
  return [...wrappedFileExtensions].some((extension) =>
    normalizedPath.endsWith(extension),
  );
}

export function FileTabView() {
  const { focusedFilePath } = useGitPanel();
  const { session } = useSessionChatMetadataContext();

  const requestUrl = useMemo(() => {
    if (!focusedFilePath) return null;
    const params = new URLSearchParams({ path: focusedFilePath });
    return `/api/sessions/${session.id}/files/content?${params.toString()}`;
  }, [focusedFilePath, session.id]);

  const { data, error, isLoading, isValidating, mutate } =
    useSWR<WorkspaceFileContentResponse>(requestUrl, fetcherNoStore, {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    });

  if (!focusedFilePath) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center border-b border-border px-4 py-2">
          <span className="text-sm font-medium text-muted-foreground font-mono">
            No file selected
          </span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground/50">
          <FileText className="h-8 w-8" />
          <p className="text-sm">
            Select a file from the Files panel to view its contents
          </p>
        </div>
      </div>
    );
  }

  const fileName = focusedFilePath.split("/").pop() ?? focusedFilePath;
  const isRefreshing = isValidating && !isLoading;
  const errorMessage = error?.message ?? null;
  const hasContent = data != null && data.content.length > 0;
  const fileOptions = shouldWrapFileContent(focusedFilePath)
    ? { ...defaultFileOptions, overflow: "wrap" as const }
    : defaultFileOptions;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-sm font-medium font-mono">
            {fileName}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {focusedFilePath}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void mutate()}
                disabled={isLoading || isRefreshing}
                className="h-7 w-7 px-0"
              >
                <RefreshCw
                  className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Refresh</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {errorMessage && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-red-600 dark:text-red-400">
              {errorMessage}
            </p>
          </div>
        )}

        {!isLoading && !errorMessage && data && (
          <div>
            {hasContent ? (
              <DiffsFile
                key={focusedFilePath}
                file={{ name: focusedFilePath, contents: data.content }}
                options={fileOptions}
              />
            ) : (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                This file is empty.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
