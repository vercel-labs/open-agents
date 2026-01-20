"use client";

import { useState, useEffect, useRef } from "react";
import useSWR from "swr";
import { GitBranch, ChevronDown, CheckIcon, PlusIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetcher } from "@/lib/swr";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

interface BranchSelectorCompactProps {
  owner: string;
  repo: string;
  value: string | null;
  isNewBranch: boolean;
  onChange: (branch: string | null, isNewBranch: boolean) => void;
}

interface BranchesResponse {
  branches: string[];
  defaultBranch: string;
}

export function BranchSelectorCompact({
  owner,
  repo,
  value,
  isNewBranch,
  onChange,
}: BranchSelectorCompactProps) {
  const [open, setOpen] = useState(false);

  // Track which owner/repo combo we've auto-selected for.
  // This prevents re-triggering auto-selection when switching between repos,
  // but intentionally does NOT reset when returning to a previously visited repo.
  // This means if a user manually clears their selection and switches back,
  // auto-selection won't re-trigger - treating it as an intentional user action.
  const autoSelectedKeyRef = useRef<string | null>(null);

  // Conditional fetch based on owner and repo
  const { data, isLoading } = useSWR<BranchesResponse>(
    owner && repo
      ? `/api/github/branches?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`
      : null,
    fetcher,
  );

  const branches = data?.branches ?? [];
  const defaultBranch = data?.defaultBranch ?? "main";

  // Auto-select default branch when data loads (only once per owner/repo combo)
  useEffect(() => {
    // Guard against undefined owner/repo to prevent matching "undefined/undefined"
    if (!owner || !repo) return;

    const key = `${owner}/${repo}`;
    if (
      data?.defaultBranch &&
      !value &&
      !isNewBranch &&
      autoSelectedKeyRef.current !== key
    ) {
      autoSelectedKeyRef.current = key;
      onChange(data.defaultBranch, false);
    }
  }, [data, value, isNewBranch, onChange, owner, repo]);

  const handleSelectBranch = (branch: string) => {
    onChange(branch, false);
    setOpen(false);
  };

  const handleSelectNewBranch = () => {
    onChange(null, true);
    setOpen(false);
  };

  const getDisplayText = () => {
    if (isLoading) return "Loading...";
    if (isNewBranch) return "New branch (auto)";
    return value || defaultBranch || "main";
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-300"
        >
          <GitBranch className="h-4 w-4" />
          <span className="max-w-[120px] truncate">{getDisplayText()}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search branches..." />
          <CommandList>
            <CommandEmpty>
              {isLoading ? "Loading..." : "No branches found."}
            </CommandEmpty>
            <CommandGroup>
              {branches.map((branch) => (
                <CommandItem
                  key={branch}
                  value={branch}
                  onSelect={() => handleSelectBranch(branch)}
                >
                  <CheckIcon
                    className={cn(
                      "mr-2 size-4",
                      value === branch && !isNewBranch
                        ? "opacity-100"
                        : "opacity-0",
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
            <CommandSeparator />
            <CommandGroup>
              <CommandItem onSelect={handleSelectNewBranch}>
                <CheckIcon
                  className={cn(
                    "mr-2 size-4",
                    isNewBranch ? "opacity-100" : "opacity-0",
                  )}
                />
                <PlusIcon className="mr-2 size-4" />
                New branch (auto-generated)
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
