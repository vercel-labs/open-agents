"use client";

import { useState } from "react";
import { ChevronDown, CheckIcon } from "lucide-react";
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
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export type SandboxType = "vercel";

interface SandboxOption {
  id: SandboxType;
  name: string;
  description: string;
}

export const SANDBOX_OPTIONS: SandboxOption[] = [
  {
    id: "vercel",
    name: "Vercel",
    description: "Full cloud sandbox",
  },
];

export const DEFAULT_SANDBOX_TYPE: SandboxType = "vercel";

interface SandboxSelectorCompactProps {
  value: SandboxType;
  onChange: (sandboxType: SandboxType) => void;
}

export function SandboxSelectorCompact({
  value,
  onChange,
}: SandboxSelectorCompactProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = (sandboxType: SandboxType) => {
    onChange(sandboxType);
    setOpen(false);
  };

  const selectedSandbox = SANDBOX_OPTIONS.find((s) => s.id === value);
  const displayText = selectedSandbox?.name ?? value;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-300"
        >
          <span className="max-w-[100px] truncate">{displayText}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandList>
            <CommandEmpty>No sandbox types found.</CommandEmpty>
            <CommandGroup>
              {SANDBOX_OPTIONS.map((sandbox) => (
                <CommandItem
                  key={sandbox.id}
                  value={sandbox.id}
                  onSelect={() => handleSelect(sandbox.id)}
                >
                  <CheckIcon
                    className={cn(
                      "mr-2 size-4",
                      value === sandbox.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="flex flex-col">
                    <span>{sandbox.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {sandbox.description}
                    </span>
                  </div>
                  {sandbox.id === DEFAULT_SANDBOX_TYPE && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      default
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
