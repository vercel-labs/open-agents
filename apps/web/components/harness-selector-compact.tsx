"use client";

import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { HarnessIcon } from "@/components/harness-icon";
import { SelectorTriggerButton } from "@/components/selector-trigger-button";
import { CHAT_HARNESS_OPTIONS, type ChatHarnessId } from "@/lib/chat-harnesses";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface HarnessSelectorCompactProps {
  value: ChatHarnessId;
  onChange: (harnessId: ChatHarnessId) => void;
  disabled?: boolean;
  disabledReason?: string;
  onCloseAutoFocus?: () => void;
}

export function HarnessSelectorCompact({
  value,
  onChange,
  disabled = false,
  disabledReason,
  onCloseAutoFocus,
}: HarnessSelectorCompactProps) {
  const [open, setOpen] = useState(false);
  const selectedOption = CHAT_HARNESS_OPTIONS.find(
    (option) => option.id === value,
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <SelectorTriggerButton
          disabled={disabled}
          aria-label="Change harness"
          title={disabledReason ?? "Change harness"}
          icon={<HarnessIcon harnessId={value} className="size-3.5 shrink-0" />}
          label={selectedOption?.label ?? value}
          labelClassName="max-w-[110px]"
        />
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0"
        align="start"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onCloseAutoFocus?.();
        }}
      >
        <Command>
          <CommandList>
            <CommandGroup heading="Harness">
              {CHAT_HARNESS_OPTIONS.map((option) => (
                <CommandItem
                  key={option.id}
                  value={`${option.label} ${option.description}`}
                  onSelect={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                  className="items-start"
                >
                  <HarnessIcon
                    harnessId={option.id}
                    className="mt-0.5 size-3.5 shrink-0 opacity-70"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </span>
                  <CheckIcon
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      value === option.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
