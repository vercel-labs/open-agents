"use client";

import { File as DiffsFile } from "@pierre/diffs/react";
import { Loader2, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import useSWR from "swr";
import type { WorkspaceFileContentResponse } from "@/app/api/sessions/[sessionId]/files/content/route";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { defaultFileOptions } from "@/lib/diffs-config";
import { fetcherNoStore } from "@/lib/swr";
import { cn } from "@/lib/utils";

type WorkspaceFileViewerProps = {
  filePath: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
};

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
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 lg:pr-12">
        <p className="min-w-0 truncate font-mono text-sm text-foreground">
          {filePath}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={isLoading || isRefreshing}
          className="h-7 shrink-0 px-2"
          title="Refresh file contents"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
          />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
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
          response.content.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              This file is empty.
            </div>
          ) : (
            <DiffsFile
              file={{ name: filePath, contents: response.content }}
              options={defaultFileOptions}
            />
          )
        ) : (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            No file selected.
          </div>
        )}
      </div>
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
          <DrawerTitle className="sr-only">{filePath}</DrawerTitle>
          <DrawerDescription className="sr-only">
            Viewing workspace file
          </DrawerDescription>
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
        <DialogTitle className="sr-only">{filePath}</DialogTitle>
        <DialogDescription className="sr-only">
          Viewing workspace file
        </DialogDescription>
        {body}
      </DialogContent>
    </Dialog>
  );
}
