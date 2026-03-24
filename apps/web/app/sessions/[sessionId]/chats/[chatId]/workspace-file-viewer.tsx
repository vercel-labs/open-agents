"use client";

import { FileText, Loader2, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import useSWR from "swr";
import type { WorkspaceFileContentResponse } from "@/app/api/sessions/[sessionId]/files/content/route";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useIsMobile } from "@/hooks/use-mobile";
import { fetcherNoStore } from "@/lib/swr";
import { cn } from "@/lib/utils";

type WorkspaceFileViewerProps = {
  filePath: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
};

function FilePreview({ content }: { content: string }) {
  const lines = useMemo(() => content.split("\n"), [content]);

  if (content.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground">
        This file is empty.
      </div>
    );
  }

  return (
    <div className="min-w-max px-4 py-4 font-mono text-[13px] leading-6 text-foreground">
      {lines.map((line, index) => (
        <div
          key={`${index}-${line.length}`}
          className="grid grid-cols-[auto_1fr] gap-4"
        >
          <span className="select-none text-right text-xs text-muted-foreground/60">
            {index + 1}
          </span>
          <span className="whitespace-pre">{line || " "}</span>
        </div>
      ))}
    </div>
  );
}

function ViewerBody({
  errorMessage,
  filePath,
  isLoading,
  isRefreshing,
  onRefresh,
  response,
}: {
  errorMessage: string | null;
  filePath: string;
  isLoading: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  response: WorkspaceFileContentResponse | undefined;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span>Workspace file</span>
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {filePath}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={isLoading || isRefreshing}
          className="shrink-0"
        >
          {isRefreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="sr-only">Refresh file contents</span>
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {isLoading ? (
          <div className="flex h-full min-h-48 items-center justify-center px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading file contents…
          </div>
        ) : errorMessage ? (
          <div className="px-4 py-6 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : response ? (
          <FilePreview content={response.content} />
        ) : (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            No file selected.
          </div>
        )}
      </ScrollArea>
    </>
  );
}

export function WorkspaceFileViewer({
  filePath,
  open,
  onOpenChange,
  sessionId,
}: WorkspaceFileViewerProps) {
  const isMobile = useIsMobile();
  const requestUrl = useMemo(() => {
    if (!open || !filePath) {
      return null;
    }

    const params = new URLSearchParams({ path: filePath });
    return `/api/sessions/${sessionId}/files/content?${params.toString()}`;
  }, [filePath, open, sessionId]);

  const { data, error, isLoading, isValidating, mutate } =
    useSWR<WorkspaceFileContentResponse>(requestUrl, fetcherNoStore, {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    });

  if (!filePath) {
    return null;
  }

  const errorMessage = error?.message ?? null;
  const isRefreshing = isValidating && !isLoading;
  const body = (
    <ViewerBody
      errorMessage={errorMessage}
      filePath={filePath}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      onRefresh={() => {
        void mutate();
      }}
      response={data}
    />
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="h-[90vh] max-h-[90vh] gap-0">
          <DrawerHeader className="border-b border-border text-left">
            <DrawerTitle>File preview</DrawerTitle>
            <DrawerDescription>
              Showing the current file contents from the live workspace.
            </DrawerDescription>
          </DrawerHeader>
          {body}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex h-[88vh] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl",
        )}
      >
        <DialogHeader className="border-b border-border px-4 py-3 text-left">
          <DialogTitle>File preview</DialogTitle>
          <DialogDescription>
            Showing the current file contents from the live workspace.
          </DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
