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
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  type AvailableModel,
  DEFAULT_MODEL_ID,
  getModelDisplayName,
} from "@/lib/models";

interface ModelSelectorCompactProps {
  value: string;
  models?: AvailableModel[];
  isLoading?: boolean;
  onChange: (modelId: string) => void;
}

export function ModelSelectorCompact({
  value,
  models = [],
  isLoading = false,
  onChange,
}: ModelSelectorCompactProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = (modelId: string) => {
    onChange(modelId);
    setOpen(false);
  };

  const selectedModel = models.find((m) => m.id === value);
  const displayText = isLoading
    ? "Loading..."
    : selectedModel
      ? getModelDisplayName(selectedModel)
      : value;

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
            <CommandEmpty>
              {isLoading ? "Loading..." : "No models found."}
            </CommandEmpty>
            <CommandGroup>
              {models.map((model) => (
                <CommandItem
                  key={model.id}
                  value={model.id}
                  onSelect={() => handleSelect(model.id)}
                >
                  <CheckIcon
                    className={cn(
                      "mr-2 size-4",
                      value === model.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="flex flex-col">
                    <span>{getModelDisplayName(model)}</span>
                    <span className="text-xs text-muted-foreground">
                      {model.id}
                    </span>
                  </div>
                  {model.id === DEFAULT_MODEL_ID && (
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
