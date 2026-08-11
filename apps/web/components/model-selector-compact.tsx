"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckIcon } from "lucide-react";
import { SelectorTriggerButton } from "@/components/selector-trigger-button";
import { type ModelOption, groupByProvider } from "@/lib/model-options";
import { APP_DEFAULT_MODEL_ID } from "@/lib/models";
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
  ProviderIcon,
  getProviderDisplayName,
} from "@/components/provider-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ModelSelectorCompactProps {
  value: string;
  modelOptions: ModelOption[];
  onChange: (modelId: string) => void;
  disabled?: boolean;
  onCloseAutoFocus?: () => void;
  /** Provider pinned to the top of the list, if any. */
  preferredProvider?: string;
  /** Warning shown next to models that are not from `preferredProvider`. */
  providerWarning?: string;
}

function ModelProviderWarning({ message }: { message: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={message}
          className="inline-flex shrink-0 text-amber-600 dark:text-amber-400"
        >
          <AlertTriangle className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {message}
      </TooltipContent>
    </Tooltip>
  );
}

export function ModelSelectorCompact({
  value,
  modelOptions,
  onChange,
  disabled = false,
  onCloseAutoFocus,
  preferredProvider,
  providerWarning,
}: ModelSelectorCompactProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const focusSearchInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      const input = searchInputRef.current;
      if (!input) {
        return;
      }
      input.focus();
      input.select();
    });
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    focusSearchInput();
  }, [focusSearchInput, open]);

  useEffect(() => {
    if (disabled) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const isModelShortcut =
        event.metaKey &&
        event.altKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        event.code === "Slash";

      if (!isModelShortcut || event.repeat) {
        return;
      }

      event.preventDefault();
      setSearch("");
      setOpen(true);
      focusSearchInput();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled, focusSearchInput]);

  const handleSelect = (modelId: string) => {
    onChange(modelId);
    setSearch("");
    setOpen(false);
  };

  const isNonPreferredProvider = (provider: string): boolean =>
    preferredProvider !== undefined && provider !== preferredProvider;

  const selectedOption = modelOptions.find((option) => option.id === value);
  const displayText = selectedOption?.shortLabel ?? value;
  const selectedProviderWarning =
    selectedOption && isNonPreferredProvider(selectedOption.provider)
      ? providerWarning
      : undefined;

  const groups = useMemo(
    () => groupByProvider(modelOptions, preferredProvider),
    [modelOptions, preferredProvider],
  );

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setSearch("");
        }
      }}
    >
      <PopoverTrigger asChild>
        <SelectorTriggerButton
          disabled={disabled}
          aria-label="Change model"
          aria-keyshortcuts="Meta+Alt+/"
          title="Change model (⌘⌥/)"
          icon={
            selectedOption ? (
              <ProviderIcon
                provider={selectedOption.provider}
                className="size-3.5 shrink-0"
              />
            ) : undefined
          }
          label={displayText}
          labelClassName="max-w-[140px]"
          trailing={
            selectedProviderWarning ? (
              <ModelProviderWarning message={selectedProviderWarning} />
            ) : undefined
          }
        />
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-0"
        align="start"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          focusSearchInput();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onCloseAutoFocus?.();
        }}
      >
        <Command>
          <CommandInput
            ref={searchInputRef}
            value={search}
            onValueChange={setSearch}
            placeholder="Search models..."
          />
          <CommandList>
            <CommandEmpty>No models found.</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup
                key={group.provider}
                heading={getProviderDisplayName(group.provider)}
              >
                {group.options.map((option) => {
                  const optionProviderWarning = isNonPreferredProvider(
                    option.provider,
                  )
                    ? providerWarning
                    : undefined;

                  return (
                    <CommandItem
                      key={option.id}
                      value={`${option.label} ${option.id}`}
                      onSelect={() => handleSelect(option.id)}
                      className="flex items-center"
                    >
                      <ProviderIcon
                        provider={option.provider}
                        className="mr-1.5 size-3.5 shrink-0 opacity-70"
                      />
                      <span className="min-w-0 truncate">
                        {option.shortLabel}
                      </span>
                      {option.isVariant && (
                        <span className="ml-1.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                          variant
                        </span>
                      )}
                      <span className="ml-auto flex shrink-0 items-center gap-1.5">
                        {option.id === APP_DEFAULT_MODEL_ID && (
                          <span className="text-xs text-muted-foreground">
                            default
                          </span>
                        )}
                        {optionProviderWarning && (
                          <ModelProviderWarning
                            message={optionProviderWarning}
                          />
                        )}
                        <CheckIcon
                          className={cn(
                            "size-4",
                            value === option.id ? "opacity-100" : "opacity-0",
                          )}
                        />
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
