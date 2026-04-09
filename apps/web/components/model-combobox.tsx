"use client";

import { useMemo, useState } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ProviderIcon,
  getProviderFromModelId,
  getProviderDisplayName,
} from "@/components/provider-icons";

interface ModelComboboxItem {
  id: string;
  label: string;
  description?: string;
  isVariant?: boolean;
  provider?: string;
}

interface ModelComboboxProps {
  value: string;
  items: ModelComboboxItem[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  onChange: (value: string) => void;
}

function groupByProvider(items: ModelComboboxItem[]) {
  const groups: Record<string, ModelComboboxItem[]> = {};
  const order: string[] = [];
  for (const item of items) {
    const provider = item.provider ?? getProviderFromModelId(item.id);
    if (!groups[provider]) {
      groups[provider] = [];
      order.push(provider);
    }
    groups[provider].push(item);
  }
  return order.map((provider) => ({
    provider,
    label: getProviderDisplayName(provider),
    options: groups[provider],
  }));
}

export function ModelCombobox({
  value,
  items,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  disabled = false,
  className,
  onChange,
}: ModelComboboxProps) {
  const [open, setOpen] = useState(false);

  const selectedItem = items.find((item) => item.id === value);
  const displayText = selectedItem?.label ?? placeholder;
  const selectedProvider =
    selectedItem?.provider ?? (selectedItem ? getProviderFromModelId(selectedItem.id) : undefined);

  const groups = useMemo(() => groupByProvider(items), [items]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50 flex h-9 w-full max-w-xs items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selectedProvider && (
              <ProviderIcon
                provider={selectedProvider}
                className="size-3.5 shrink-0"
              />
            )}
            <span className="truncate text-left">{displayText}</span>
            {selectedItem?.isVariant && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                variant
              </span>
            )}
          </span>
          <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup
                key={group.provider}
                heading={
                  <span className="flex items-center gap-1.5">
                    <ProviderIcon
                      provider={group.provider}
                      className="size-3 opacity-60"
                    />
                    {group.label}
                  </span>
                }
              >
                {group.options.map((item) => (
                  <Tooltip key={item.id}>
                    <TooltipTrigger asChild>
                      <CommandItem
                        value={`${item.label} ${item.id} ${item.description ?? ""}`}
                        onSelect={() => {
                          onChange(item.id);
                          setOpen(false);
                        }}
                      >
                        <CheckIcon
                          className={cn(
                            "mr-2 size-4 shrink-0",
                            value === item.id ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate">{item.label}</span>
                          {item.isVariant && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                              variant
                            </span>
                          )}
                        </span>
                      </CommandItem>
                    </TooltipTrigger>
                    {item.description && (
                      <TooltipContent side="right" sideOffset={8}>
                        {item.description}
                      </TooltipContent>
                    )}
                  </Tooltip>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
