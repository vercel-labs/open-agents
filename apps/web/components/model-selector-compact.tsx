"use client";

import { useState } from "react";
import { CheckIcon, ChevronDown } from "lucide-react";
import { type ModelOption } from "@/lib/model-options";
import { DEFAULT_MODEL_ID } from "@/lib/models";
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
} from "@/components/ui/command";

interface ModelSelectorCompactProps {
  value: string;
  modelOptions: ModelOption[];
  onChange: (modelId: string) => void;
}

export function ModelSelectorCompact({
  value,
  modelOptions,
  onChange,
}: ModelSelectorCompactProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = (modelId: string) => {
    onChange(modelId);
    setOpen(false);
  };

  const selectedOption = modelOptions.find((option) => option.id === value);
  const displayText = selectedOption?.label ?? value;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-300"
        >
          <span className="max-w-[140px] truncate">{displayText}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search models..." />
          <CommandList>
            <CommandEmpty>No models found.</CommandEmpty>
            <CommandGroup>
              {modelOptions.map((option) => (
                <CommandItem
                  key={option.id}
                  value={`${option.label} ${option.id} ${option.description ?? ""}`}
                  onSelect={() => handleSelect(option.id)}
                >
                  <CheckIcon
                    className={cn(
                      "mr-2 size-4",
                      value === option.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate">{option.label}</span>
                      {option.isVariant && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                          variant
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {option.description ?? option.id}
                    </p>
                  </div>
                  {option.id === DEFAULT_MODEL_ID && (
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
