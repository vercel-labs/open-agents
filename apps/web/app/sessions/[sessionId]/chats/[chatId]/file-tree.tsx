"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { FileSuggestion } from "@/app/api/sessions/[sessionId]/files/route";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";

type FileTreeProps = {
  files: FileSuggestion[];
  repoName?: string | null;
  onFileClick: (filePath: string) => void;
};

export function FileTree({ files, repoName, onFileClick }: FileTreeProps) {
  const onFileClickRef = useRef(onFileClick);
  onFileClickRef.current = onFileClick;

  const paths = useMemo(
    () =>
      files.map((f) =>
        f.isDirectory ? f.value.replace(/\/?$/, "/") : f.value,
      ),
    [files],
  );

  const handleSelectionChange = useCallback(
    (selectedPaths: readonly string[]) => {
      if (selectedPaths.length === 0) return;
      const path = selectedPaths[selectedPaths.length - 1];
      // Only fire for files, not directories
      if (!path.endsWith("/")) {
        onFileClickRef.current(path);
      }
    },
    [],
  );

  const { model } = useFileTree({
    paths,
    density: "compact",
    initialExpansion: "closed",
    flattenEmptyDirectories: true,
    onSelectionChange: handleSelectionChange,
  });

  // Keep paths in sync when files change
  const prevPathsRef = useRef(paths);
  useEffect(() => {
    if (prevPathsRef.current !== paths) {
      prevPathsRef.current = paths;
      model.resetPaths(paths);
    }
  }, [paths, model]);

  if (files.length === 0) {
    return (
      <div className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/25 py-8 text-center">
        <p className="text-xs text-muted-foreground">No files found</p>
      </div>
    );
  }

  return (
    <PierreFileTree
      model={model}
      header={
        repoName ? (
          <span className="text-xs font-medium text-muted-foreground">
            {repoName}
          </span>
        ) : undefined
      }
      style={
        {
          "--trees-fg-override": "var(--foreground)",
          "--trees-border-color-override": "var(--border)",
          "--trees-selected-bg-override": "var(--muted)",
          height: "100%",
        } as React.CSSProperties
      }
    />
  );
}
