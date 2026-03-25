"use client";

import { ExternalLink, Loader2, Square } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { DevServerControls } from "./hooks/use-dev-server";

interface DevServerMenuItemsProps {
  canRun: boolean;
  devServer: DevServerControls;
}

export function DevServerMenuItems({
  canRun,
  devServer,
}: DevServerMenuItemsProps) {
  const isPrimaryBusy =
    devServer.state.status === "starting" ||
    devServer.state.status === "stopping";

  return (
    <>
      <DropdownMenuItem
        disabled={isPrimaryBusy || !canRun}
        onClick={() => {
          void devServer.handlePrimaryAction();
        }}
        className={cn(
          "gap-2",
          devServer.menuDetail ? "items-start" : undefined,
        )}
      >
        {isPrimaryBusy ? (
          <Loader2 className="mt-0.5 h-4 w-4 animate-spin" />
        ) : (
          <ExternalLink
            className={cn(
              "h-4 w-4 shrink-0",
              devServer.menuDetail ? "mt-0.5" : undefined,
            )}
          />
        )}
        {devServer.menuDetail ? (
          <span className="flex min-w-0 flex-1 flex-col">
            <span>{devServer.menuLabel}</span>
            <span className="truncate text-xs text-muted-foreground">
              {devServer.menuDetail}
            </span>
          </span>
        ) : (
          <span>{devServer.menuLabel}</span>
        )}
      </DropdownMenuItem>
      {devServer.showStopAction ? (
        <DropdownMenuItem
          disabled={devServer.state.status === "stopping"}
          onClick={() => {
            void devServer.handleStopAction();
          }}
        >
          {devServer.state.status === "stopping" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Square className="mr-2 h-3.5 w-3.5 fill-current" />
          )}
          {devServer.state.status === "stopping"
            ? "Stopping Dev Server..."
            : "Stop Dev Server"}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
    </>
  );
}
