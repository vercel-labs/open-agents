"use client";

import type { TableRow } from "./shared";

export function TableResultView({
  rows,
  columns,
}: {
  rows: TableRow[];
  columns: string[];
}) {
  // Find a "name" or "title" column for the primary display
  const nameCol = columns.find((c) => /^(name|title)$/i.test(c));
  const otherCols = columns.filter((c) => c !== nameCol && c !== "has_more");

  return (
    <div className="ml-4 space-y-0">
      {rows.map((row, i) => {
        const name = nameCol ? String(row[nameCol] ?? "") : `Row ${i + 1}`;
        const detail = otherCols
          .map((c) => {
            const val = row[c];
            if (val == null || val === "") return null;
            return `${c}: ${String(val)}`;
          })
          .filter(Boolean)
          .join(" · ");

        return (
          <div key={i} className="flex flex-col gap-0.5 rounded px-1.5 py-1">
            <span className="text-[11px] font-medium text-foreground/90">
              {name}
            </span>
            {detail && (
              <span className="text-[10px] text-muted-foreground/60 line-clamp-2">
                {detail}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
