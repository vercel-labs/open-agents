"use client";

import { File as DiffsFile } from "@pierre/diffs/react";
import { Check, CodeXml, Copy, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
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
import { SelectionPopover } from "@/components/selection-popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { defaultFileOptions } from "@/lib/diffs-config";
import { streamdownPlugins } from "@/lib/streamdown-config";
import { fetcherNoStore } from "@/lib/swr";
import { cn } from "@/lib/utils";

type WorkspaceFileViewerProps = {
  editorBusy?: boolean;
  editorDisabledReason?: string | null;
  filePath: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenInEditor?: (filePath: string) => void;
  onAddToPrompt?: (
    filePath: string,
    selectedText: string,
    comment: string,
  ) => void;
  sessionId: string;
};

type ViewerMode = "raw" | "pretty";
type PrettyViewKind = "markdown" | "text";

const wrappedFileExtensions = new Set([".md", ".mdx", ".markdown", ".txt"]);
const markdownExtensions = new Set([".md", ".mdx", ".markdown"]);
const plainTextExtensions = new Set([".txt"]);

function getFileExtension(filePath: string) {
  const normalizedPath = filePath.toLowerCase();
  const lastDotIndex = normalizedPath.lastIndexOf(".");

  if (lastDotIndex === -1) {
    return "";
  }

  return normalizedPath.slice(lastDotIndex);
}

function shouldWrapFileContent(filePath: string) {
  return wrappedFileExtensions.has(getFileExtension(filePath));
}

function getPrettyViewKind(filePath: string): PrettyViewKind | null {
  const extension = getFileExtension(filePath);

  if (markdownExtensions.has(extension)) {
    return "markdown";
  }

  if (plainTextExtensions.has(extension)) {
    return "text";
  }

  return null;
}

function getDefaultViewerMode(filePath: string): ViewerMode {
  const fileName = filePath.split("/").pop()?.toLowerCase();
  return fileName === "plan.md" ? "pretty" : "raw";
}

function useCopyAction() {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  return { copied, copy };
}

function CopyButton({
  text,
  title,
  className,
}: {
  text: string;
  title: string;
  className?: string;
}) {
  const { copied, copy } = useCopyAction();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => copy(text)}
      className={cn("h-7 shrink-0 px-2", className)}
      title={title}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}

function stripMarkdownFrontmatter(content: string) {
  const frontmatterMatch = content.match(
    /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/,
  );

  if (!frontmatterMatch) {
    return content;
  }

  return content.slice(frontmatterMatch[0].length);
}

function PrettyMarkdown({ content }: { content: string }) {
  return (
    <div className="p-6">
      <Streamdown mode="static" isAnimating={false} plugins={streamdownPlugins}>
        {stripMarkdownFrontmatter(content)}
      </Streamdown>
    </div>
  );
}

function PrettyText({ content }: { content: string }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words p-6 text-sm leading-6 text-foreground">
      {content}
    </pre>
  );
}

function PrettyFileContent({
  content,
  kind,
}: {
  content: string;
  kind: PrettyViewKind;
}) {
  if (kind === "markdown") {
    return <PrettyMarkdown content={content} />;
  }

  return <PrettyText content={content} />;
}

function ViewModeToggle({
  mode,
  onModeChange,
}: {
  mode: ViewerMode;
  onModeChange: (mode: ViewerMode) => void;
}) {
  return (
    <div className="flex items-center rounded-md border border-border bg-muted p-0.5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={mode === "raw"}
        onClick={() => onModeChange("raw")}
        className={cn(
          "h-6 px-2 text-xs",
          mode === "raw" && "bg-background shadow-xs hover:bg-background",
        )}
      >
        Raw
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={mode === "pretty"}
        onClick={() => onModeChange("pretty")}
        className={cn(
          "h-6 px-2 text-xs",
          mode === "pretty" && "bg-background shadow-xs hover:bg-background",
        )}
      >
        Pretty
      </Button>
    </div>
  );
}

function ViewerBody({
  editorBusy,
  editorDisabledReason,
  errorMessage,
  filePath,
  isLoading,
  isRefreshing,
  onOpenInEditor,
  onRefresh,
  onAddToPrompt,
  response,
}: {
  editorBusy?: boolean;
  editorDisabledReason?: string | null;
  errorMessage: string | null;
  filePath: string;
  isLoading: boolean;
  isRefreshing: boolean;
  onOpenInEditor?: () => void;
  onRefresh: () => void;
  onAddToPrompt?: (selectedText: string, comment: string) => void;
  response: WorkspaceFileContentResponse | undefined;
}) {
  const [viewerMode, setViewerMode] = useState<ViewerMode>(() =>
    getDefaultViewerMode(filePath),
  );
  const hasContent = response != null && response.content.length > 0;
  const prettyViewKind = getPrettyViewKind(filePath);
  const supportsPrettyView = prettyViewKind != null;
  const fileOptions = shouldWrapFileContent(filePath)
    ? { ...defaultFileOptions, overflow: "wrap" as const }
    : defaultFileOptions;
  const contentRef = useRef<HTMLDivElement>(null);
  const openInEditorTitle = editorBusy
    ? "Starting editor…"
    : (editorDisabledReason ?? "Open in code editor");

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 lg:pr-12">
        <div className="flex min-w-0 items-center gap-1">
          <p className="min-w-0 break-all font-mono text-sm text-foreground">
            {filePath}
          </p>
          <CopyButton text={filePath} title="Copy file path" />
        </div>
        <div className="flex items-center gap-1">
          {supportsPrettyView && (
            <ViewModeToggle mode={viewerMode} onModeChange={setViewerMode} />
          )}
          {onOpenInEditor && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={editorBusy || editorDisabledReason != null}
              onClick={onOpenInEditor}
              className="h-7 shrink-0 gap-1.5 px-2 text-xs"
              title={openInEditorTitle}
            >
              {editorBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CodeXml className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">
                {editorBusy ? "Starting Editor…" : "Open in Editor"}
              </span>
            </Button>
          )}
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
      </div>

      <div ref={contentRef} className="relative min-h-0 flex-1 overflow-auto">
        {hasContent && (
          <CopyButton
            text={response.content}
            title="Copy file contents"
            className="absolute top-2 right-4 z-10 border border-border/60 bg-background/80 shadow-sm backdrop-blur-sm hover:bg-muted"
          />
        )}
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
          ) : viewerMode === "pretty" && prettyViewKind ? (
            <PrettyFileContent
              content={response.content}
              kind={prettyViewKind}
            />
          ) : (
            <DiffsFile
              file={{ name: filePath, contents: response.content }}
              options={fileOptions}
            />
          )
        ) : (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            No file selected.
          </div>
        )}
        {onAddToPrompt && hasContent && (
          <SelectionPopover
            containerRef={contentRef}
            onAddToPrompt={onAddToPrompt}
          />
        )}
      </div>
    </>
  );
}

export function WorkspaceFileViewer({
  editorBusy,
  editorDisabledReason,
  filePath,
  open,
  onOpenChange,
  onOpenInEditor,
  onAddToPrompt,
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

  const handleAddToPrompt = onAddToPrompt
    ? (selectedText: string, comment: string) => {
        onAddToPrompt(filePath, selectedText, comment);
      }
    : undefined;

  const body = (
    <ViewerBody
      key={filePath}
      editorBusy={editorBusy}
      editorDisabledReason={editorDisabledReason}
      errorMessage={errorMessage}
      filePath={filePath}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      onOpenInEditor={
        onOpenInEditor ? () => onOpenInEditor(filePath) : undefined
      }
      onRefresh={() => {
        void mutate();
      }}
      onAddToPrompt={handleAddToPrompt}
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
