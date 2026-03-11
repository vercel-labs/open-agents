"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { format, subMonths } from "date-fns";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DateRangePickerProps {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  className?: string;
}

export function DateRangePicker({
  value,
  onChange,
  className,
}: DateRangePickerProps) {
  const today = React.useMemo(() => new Date(), []);
  const defaultMonth = value?.from ?? subMonths(today, 1);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          id="date-picker-range"
          className={cn(
            "justify-start px-2.5 font-normal",
            !value?.from && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon />
          {value?.from ? (
            value.to ? (
              <>
                {format(value.from, "LLL dd, y")} -{" "}
                {format(value.to, "LLL dd, y")}
              </>
            ) : (
              format(value.from, "LLL dd, y")
            )
          ) : (
            <span>Pick a date</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          initialFocus
          mode="range"
          defaultMonth={defaultMonth}
          selected={value}
          onSelect={onChange}
          numberOfMonths={2}
          disabled={{ after: today }}
          endMonth={today}
        />
      </PopoverContent>
    </Popover>
  );
}
