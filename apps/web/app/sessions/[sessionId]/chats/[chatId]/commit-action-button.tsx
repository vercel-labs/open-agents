"use client";

import { GitCommit, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

interface CommitActionButtonProps {
  label: string;
  isAutoCommitting: boolean;
  hasUncommittedChanges: boolean;
  onClick: () => void;
}

/** Primary header button for commit actions (outline style, responsive). */
export function CommitActionHeaderButton({
  label,
  isAutoCommitting,
  hasUncommittedChanges,
  onClick,
}: CommitActionButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="relative h-8 w-8 px-0 xl:w-auto xl:px-3"
      disabled={isAutoCommitting}
      onClick={onClick}
    >
      {isAutoCommitting ? (
        <Loader2 className="h-4 w-4 animate-spin xl:mr-2" />
      ) : (
        <GitCommit className="h-4 w-4 xl:mr-2" />
      )}
      <span className="hidden xl:inline">
        {isAutoCommitting ? "Committing..." : label}
      </span>
      {hasUncommittedChanges && !isAutoCommitting && (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-orange-500" />
      )}
    </Button>
  );
}

/** Dropdown menu item for commit actions. */
export function CommitActionMenuItem({
  label,
  isAutoCommitting,
  onClick,
}: Omit<CommitActionButtonProps, "hasUncommittedChanges">) {
  return (
    <DropdownMenuItem disabled={isAutoCommitting} onClick={onClick}>
      {isAutoCommitting ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <GitCommit className="mr-2 h-4 w-4" />
      )}
      {isAutoCommitting ? "Committing..." : label}
    </DropdownMenuItem>
  );
}
