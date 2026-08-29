"use client";

import { ChevronDown } from "lucide-react";
import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SelectorTriggerButtonProps extends ComponentPropsWithRef<"button"> {
  icon?: ReactNode;
  label: string;
  /** Extra classes for the truncating label span (e.g. a max width). */
  labelClassName?: string;
  /** Rendered between the label and the chevron (e.g. a warning icon). */
  trailing?: ReactNode;
}

/**
 * Shared compact trigger for the composer's popover selectors (harness,
 * model). Designed to sit inside a `PopoverTrigger asChild`, so it spreads
 * the injected trigger props onto the underlying button.
 */
export function SelectorTriggerButton({
  icon,
  label,
  labelClassName,
  trailing,
  className,
  ...buttonProps
}: SelectorTriggerButtonProps) {
  return (
    <button
      type="button"
      {...buttonProps}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-300 disabled:pointer-events-none disabled:opacity-60",
        className,
      )}
    >
      {icon}
      <span className={cn("truncate", labelClassName)}>{label}</span>
      {trailing}
      <ChevronDown className="h-3 w-3" />
    </button>
  );
}
