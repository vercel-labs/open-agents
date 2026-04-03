"use client";

import { useState } from "react";
import useSWR from "swr";
import { CheckIcon, GitBranch, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetcher } from "@/lib/swr";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

interface BranchesResponse {
  branches: string[];
  defaultBranch: string;
}

interface BranchPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  owner: string;
  repo: string;
  isCreating: boolean;
  onSelectBranch: (branch: string) => void;
}

export function BranchPickerDialog({
  open,
  onOpenChange,
  owner,
  repo,
  isCreating,
  onSelectBranch,
}: BranchPickerDialogProps) {
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

  const { data, isLoading } = useSWR<BranchesResponse>(
    open && owner && repo
      ? `/api/github/branches?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`
      : null,
    fetcher,
  );

  const branches = data?.branches ?? [];
  const defaultBranch = data?.defaultBranch ?? "main";

  const handleSelect = (branch: string) => {
    setSelectedBranch(branch);
    onSelectBranch(branch);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isCreating) {
          onOpenChange(nextOpen);
          if (!nextOpen) {
            setSelectedBranch(null);
          }
        }
      }}
    >
      <DialogContent className="max-w-sm gap-0 overflow-hidden p-0">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-sm font-medium">
            <GitBranch className="h-4 w-4" />
            <span>
              Select branch for {owner}/{repo}
            </span>
          </DialogTitle>
        </DialogHeader>
        {isCreating ? (
          <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Creating session on {selectedBranch}…</span>
          </div>
        ) : (
          <Command className="border-t">
            <CommandInput placeholder="Search branches…" />
            <CommandList className="max-h-64">
              <CommandEmpty>
                {isLoading ? "Loading branches…" : "No branches found."}
              </CommandEmpty>
              <CommandGroup>
                {branches.map((branch) => (
                  <CommandItem
                    key={branch}
                    value={branch}
                    onSelect={() => handleSelect(branch)}
                  >
                    <CheckIcon
                      className={cn(
                        "mr-2 size-4",
                        selectedBranch === branch ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{branch}</span>
                    {branch === defaultBranch && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        default
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </DialogContent>
    </Dialog>
  );
}
