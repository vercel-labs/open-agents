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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface BranchSelectorCompactProps {
  owner: string;
  repo: string;
  value: string;
  onChange: (branch: string) => void;
}

interface BranchesResponse {
  branches: string[];
  defaultBranch: string;
}

export function BranchSelectorCompact({
  owner,
  repo,
  value,
  onChange,
}: BranchSelectorCompactProps) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [loading, setLoading] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");

  // Use refs to avoid dependency issues in useEffect
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
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
        // Auto-select default branch if no value is set
        if (!valueRef.current) {
          onChangeRef.current(data.defaultBranch);
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
    onChange(branch);
    setOpen(false);
    setCreatingNew(false);
  };

  const handleSubmitNewBranch = () => {
    if (newBranchName.trim()) {
      onChange(newBranchName.trim());
      setNewBranchName("");
      setCreatingNew(false);
      setOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmitNewBranch();
    } else if (e.key === "Escape") {
      setCreatingNew(false);
    }
  };

  if (creatingNew) {
    return (
      <div className="flex items-center gap-2">
        <Input
          value={newBranchName}
          onChange={(e) => setNewBranchName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Branch name"
          className="h-8 w-36"
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={handleSubmitNewBranch}
          disabled={!newBranchName.trim()}
        >
          Use
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setCreatingNew(false)}>
          Cancel
        </Button>
      </div>
    );
  }

  const displayBranch = value || defaultBranch || "main";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-300"
        >
          <GitBranch className="h-4 w-4" />
          <span className="max-w-[100px] truncate">
            {loading ? "Loading..." : displayBranch}
          </span>
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
                      value === branch ? "opacity-100" : "opacity-0",
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
              <CommandItem onSelect={() => setCreatingNew(true)}>
                <PlusIcon className="mr-2 size-4" />
                Create new branch...
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
