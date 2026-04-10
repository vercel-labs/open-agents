"use client";

import { ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { FileSuggestion } from "@/app/api/sessions/[sessionId]/files/route";
import {
  FolderIcon,
  FolderOpenIcon,
  getFileIcon,
} from "@/components/file-type-icons";
import { cn } from "@/lib/utils";

type TreeNode = {
  name: string;
  path: string;
  isDirectory: boolean;
  children: TreeNode[];
};

function buildTree(files: FileSuggestion[]): TreeNode[] {
  const root: TreeNode[] = [];
  const map = new Map<string, TreeNode>();

  // Sort files so directories come first, then alphabetical
  const sorted = [...files].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.value.localeCompare(b.value);
  });

  for (const file of sorted) {
    const path = file.isDirectory ? file.value.replace(/\/$/, "") : file.value;
    const parts = path.split("/");

    let current = root;
    let currentPath = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLast = i === parts.length - 1;
      const isDir = isLast ? file.isDirectory : true;

      let node = map.get(currentPath);
      if (!node) {
        node = {
          name: part,
          path: currentPath,
          isDirectory: isDir,
          children: [],
        };
        map.set(currentPath, node);
        current.push(node);
      }
      current = node.children;
    }
  }

  // Sort each level: folders first, then files, alphabetical within each group
  function sortChildren(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children.length > 0) {
        sortChildren(node.children);
      }
    }
  }
  sortChildren(root);

  return root;
}

function FileTreeNode({
  node,
  depth,
  expanded,
  onToggle,
  onFileClick,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onFileClick: (path: string) => void;
}) {
  const isOpen = expanded.has(node.path);

  if (node.isDirectory) {
    return (
      <div>
        <button
          type="button"
          onClick={() => onToggle(node.path)}
          className={cn(
            "flex w-full items-center gap-1.5 rounded-sm px-1 py-[3px] text-left text-[13px] hover:bg-muted/80 transition-colors",
            "text-foreground",
          )}
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150",
              isOpen && "rotate-90",
            )}
          />
          {isOpen ? (
            <FolderOpenIcon className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <FolderIcon className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {isOpen && (
          <div>
            {node.children.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                onFileClick={onFileClick}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onFileClick(node.path)}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-sm px-1 py-[3px] text-left text-[13px] hover:bg-muted/80 transition-colors",
        "text-muted-foreground hover:text-foreground",
      )}
      style={{ paddingLeft: `${depth * 12 + 4 + 16}px` }}
    >
      {getFileIcon(node.name, { className: "h-3.5 w-3.5 shrink-0" })}
      <span className="truncate">{node.name}</span>
    </button>
  );
}

type FileTreeProps = {
  files: FileSuggestion[];
  onFileClick: (filePath: string) => void;
};

export function FileTree({ files, onFileClick }: FileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildTree(files), [files]);

  const handleToggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  if (tree.length === 0) {
    return (
      <div className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/25 py-8 text-center">
        <p className="text-xs text-muted-foreground">No files found</p>
      </div>
    );
  }

  return (
    <div className="space-y-px">
      {tree.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          expanded={expanded}
          onToggle={handleToggle}
          onFileClick={onFileClick}
        />
      ))}
    </div>
  );
}
