"use client";

import { CodeXml, Loader2 } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { CodeEditorControls } from "./hooks/use-code-editor";

interface CodeEditorMenuItemsProps {
  canRun: boolean;
  codeEditor: CodeEditorControls;
}

export function CodeEditorMenuItems({
  canRun,
  codeEditor,
}: CodeEditorMenuItemsProps) {
  const isBusy = codeEditor.state.status === "starting";

  return (
    <>
      <DropdownMenuItem
        disabled={isBusy || !canRun}
        onClick={() => {
          void codeEditor.handleOpen();
        }}
        className={cn(
          "gap-2",
          codeEditor.menuDetail ? "items-start" : undefined,
        )}
      >
        {isBusy ? (
          <Loader2 className="mt-0.5 h-4 w-4 animate-spin" />
        ) : (
          <CodeXml
            className={cn(
              "h-4 w-4 shrink-0",
              codeEditor.menuDetail ? "mt-0.5" : undefined,
            )}
          />
        )}
        {codeEditor.menuDetail ? (
          <span className="flex min-w-0 flex-1 flex-col">
            <span>{codeEditor.menuLabel}</span>
            <span className="truncate text-xs text-muted-foreground">
              {codeEditor.menuDetail}
            </span>
          </span>
        ) : (
          <span>{codeEditor.menuLabel}</span>
        )}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  );
}
