"use client";

import { useMemo } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DayData {
  date: string;
  inputTokens: number;
  outputTokens: number;
  messageCount: number;
  toolCallCount: number;
}

interface ContributionChartProps {
  data: DayData[];
}

const DAYS_IN_WEEK = 7;
const WEEKS = 39;
const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

function getIntensity(
  value: number,
  thresholds: [number, number, number, number],
): number {
  if (value === 0) return 0;
  if (value <= thresholds[0]) return 1;
  if (value <= thresholds[1]) return 2;
  if (value <= thresholds[2]) return 3;
  return 4;
}

function computeThresholds(values: number[]): [number, number, number, number] {
  const nonZero = values.filter((v) => v > 0).toSorted((a, b) => a - b);
  if (nonZero.length === 0) return [1, 2, 3, 4];

  const p25 = nonZero[Math.floor(nonZero.length * 0.25)] ?? 1;
  const p50 = nonZero[Math.floor(nonZero.length * 0.5)] ?? 2;
  const p75 = nonZero[Math.floor(nonZero.length * 0.75)] ?? 3;
  const max = nonZero[nonZero.length - 1] ?? 4;

  return [p25, p50, p75, max];
}

const INTENSITY_CLASSES = [
  "bg-muted",
  "bg-emerald-200 dark:bg-emerald-900",
  "bg-emerald-400 dark:bg-emerald-700",
  "bg-emerald-500 dark:bg-emerald-500",
  "bg-emerald-700 dark:bg-emerald-300",
];

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DAY_LABEL_WIDTH = 32;
const CELL_GAP = 2;
const LEGEND_CELL_SIZE = 12;
const MIN_CELL_SIZE = 10;

export function ContributionChart({ data }: ContributionChartProps) {
  const { grid, monthLabels, thresholds } = useMemo(() => {
    const dataMap = new Map<string, DayData>();
    for (const d of data) {
      dataMap.set(d.date, d);
    }

    const today = new Date();
    const todayStr = formatDateKey(today);

    // End on the last Saturday (end of current week)
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + (6 - endDate.getDay()));
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - WEEKS * DAYS_IN_WEEK + 1);

    const cells: Array<{
      date: string;
      data: DayData | undefined;
      isFuture: boolean;
    }> = [];

    const current = new Date(startDate);
    while (current <= endDate) {
      const key = formatDateKey(current);
      cells.push({
        date: key,
        data: dataMap.get(key),
        isFuture: key > todayStr,
      });
      current.setDate(current.getDate() + 1);
    }

    const values = cells
      .map((c) => c.data?.messageCount ?? 0)
      .filter((v) => v > 0);
    const t = computeThresholds(values);

    // Group into weeks (columns)
    const weeks: (typeof cells)[] = [];
    for (let i = 0; i < cells.length; i += DAYS_IN_WEEK) {
      weeks.push(cells.slice(i, i + DAYS_IN_WEEK));
    }

    // Compute month labels
    const months: Array<{ label: string; weekIndex: number }> = [];
    let lastMonth = -1;
    for (let w = 0; w < weeks.length; w++) {
      const firstDay = weeks[w]?.[0];
      if (!firstDay) continue;
      const d = new Date(firstDay.date + "T00:00:00");
      const month = d.getMonth();
      if (month !== lastMonth) {
        lastMonth = month;
        months.push({
          label: d.toLocaleDateString("en-US", { month: "short" }),
          weekIndex: w,
        });
      }
    }

    return { grid: weeks, monthLabels: months, thresholds: t };
  }, [data]);

  const weekCount = grid.length;
  const minGridWidth =
    DAY_LABEL_WIDTH + weekCount * MIN_CELL_SIZE + (weekCount - 1) * CELL_GAP;

  return (
    <div className="flex flex-col gap-1 overflow-x-auto">
      {/* Month labels */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: `${DAY_LABEL_WIDTH}px repeat(${weekCount}, 1fr)`,
          columnGap: CELL_GAP,
          minWidth: minGridWidth,
        }}
      >
        {monthLabels.map((m, i) => (
          <span
            key={`${m.label}-${i}`}
            className="whitespace-nowrap text-xs text-muted-foreground"
            style={{
              gridColumn: m.weekIndex + 2,
              gridRow: 1,
            }}
          >
            {m.label}
          </span>
        ))}
      </div>

      {/* Chart grid */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: `${DAY_LABEL_WIDTH}px repeat(${weekCount}, 1fr)`,
          gridTemplateRows: `repeat(${DAYS_IN_WEEK}, auto)`,
          gap: CELL_GAP,
          minWidth: minGridWidth,
        }}
      >
        {/* Day labels */}
        {DAY_LABELS.map((label, i) => (
          <span
            key={i}
            className="flex items-center text-xs leading-none text-muted-foreground"
            style={{ gridColumn: 1, gridRow: i + 1 }}
          >
            {label}
          </span>
        ))}

        {/* Week cells */}
        {grid.flatMap((week, wi) =>
          week.map((cell, di) => {
            if (cell.isFuture) {
              return (
                <div
                  key={cell.date}
                  style={{
                    gridColumn: wi + 2,
                    gridRow: di + 1,
                    aspectRatio: "1 / 1",
                  }}
                />
              );
            }

            const messageCount = cell.data?.messageCount ?? 0;
            const intensity = getIntensity(messageCount, thresholds);

            return (
              <Tooltip key={cell.date}>
                <TooltipTrigger asChild>
                  <div
                    className={`rounded-[2px] ${INTENSITY_CLASSES[intensity]}`}
                    style={{
                      gridColumn: wi + 2,
                      gridRow: di + 1,
                      aspectRatio: "1 / 1",
                    }}
                  />
                </TooltipTrigger>
                <TooltipContent side="top">
                  <div className="text-xs">
                    <div className="font-medium">{formatDate(cell.date)}</div>
                    {messageCount > 0 ? (
                      <>
                        <div>
                          {messageCount} message
                          {messageCount !== 1 ? "s" : ""}
                        </div>
                        <div>
                          {formatTokens(
                            (cell.data?.inputTokens ?? 0) +
                              (cell.data?.outputTokens ?? 0),
                          )}{" "}
                          tokens
                        </div>
                        <div>
                          {cell.data?.toolCallCount ?? 0} tool call
                          {(cell.data?.toolCallCount ?? 0) !== 1 ? "s" : ""}
                        </div>
                      </>
                    ) : (
                      <div className="text-muted-foreground">No activity</div>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          }),
        )}
      </div>

      {/* Legend */}
      <div className="mt-1 flex items-center justify-end gap-1 text-xs text-muted-foreground">
        <span>Less</span>
        {INTENSITY_CLASSES.map((cls, i) => (
          <div
            key={i}
            className={`rounded-[2px] ${cls}`}
            style={{ width: LEGEND_CELL_SIZE, height: LEGEND_CELL_SIZE }}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
