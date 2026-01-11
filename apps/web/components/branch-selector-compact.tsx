"use client";

import { useEffect, useRef, useState } from "react";
import { GitBranch, ChevronDown, CheckIcon, PlusIcon } from "lucide-react";
import { cn } from "@/lib/utils";
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
  const [branches, setBranches] = useState<string[]>([]);
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [loading, setLoading] = useState(false);

  // Use refs to avoid dependency issues in useEffect
  const valueRef = useRef(value);
  const isNewBranchRef = useRef(isNewBranch);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  isNewBranchRef.current = isNewBranch;
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!owner || !repo) {
      setBranches([]);
      return;
    }

    const fetchBranches = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/github/branches?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`,
        );
        if (!response.ok) {
          throw new Error("Failed to fetch branches");
        }
        const data = (await response.json()) as BranchesResponse;
        setBranches(data.branches);
        setDefaultBranch(data.defaultBranch);
        // Auto-select default branch if no value is set and not creating new branch
        if (!valueRef.current && !isNewBranchRef.current) {
          onChangeRef.current(data.defaultBranch, false);
        }
      } catch (err) {
        console.error("Failed to fetch branches:", err);
        setBranches([]);
      } finally {
        setLoading(false);
      }
    };

    fetchBranches();
  }, [owner, repo]);

  const handleSelectBranch = (branch: string) => {
    onChange(branch, false);
    setOpen(false);
  };

  const handleSelectNewBranch = () => {
    onChange(null, true);
    setOpen(false);
  };

  // Determine display text
  const getDisplayText = () => {
    if (loading) return "Loading...";
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
              {loading ? "Loading..." : "No branches found."}
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
