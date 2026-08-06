export interface UsageDateRange {
  from: string;
  to: string;
}

export type PublicUsageDateSelection =
  | {
      kind: "all";
      value: null;
      label: "All time";
      range: null;
    }
  | {
      kind: "preset";
      value: string;
      label: string;
      range: UsageDateRange;
    }
  | {
      kind: "range";
      value: string;
      label: string;
      range: UsageDateRange;
    };

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PRESET_DATE_RANGE_PATTERN = /^([1-9][0-9]{0,3})d$/;
const EXPLICIT_DATE_RANGE_PATTERN =
  /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;
const DISPLAY_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDateOnly(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isDateOnly(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) {
    return false;
  }

  const [year, month, day] = value
    .split("-")
    .map((part) => Number.parseInt(part, 10));

  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return false;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day
  );
}

export function formatDateOnlyLabel(value: string): string {
  return DISPLAY_DATE_FORMATTER.format(new Date(`${value}T00:00:00.000Z`));
}

export function formatUsageDateRangeLabel(range: UsageDateRange): string {
  const fromLabel = formatDateOnlyLabel(range.from);
  const toLabel = formatDateOnlyLabel(range.to);

  if (fromLabel === toLabel) {
    return fromLabel;
  }

  return `${fromLabel} – ${toLabel}`;
}

export function getDateRangeDaysInclusive(range: UsageDateRange): number {
  const fromMs = Date.parse(`${range.from}T00:00:00.000Z`);
  const toMs = Date.parse(`${range.to}T00:00:00.000Z`);

  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs < fromMs) {
    return 1;
  }

  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  return Math.floor((toMs - fromMs) / ONE_DAY_MS) + 1;
}

export function parseUsageDateRange(params: {
  from: string | null;
  to: string | null;
}): { ok: true; range: UsageDateRange | null } | { ok: false; error: string } {
  const { from, to } = params;

  if (from === null && to === null) {
    return { ok: true, range: null };
  }

  if (from === null || to === null) {
    return {
      ok: false,
      error: "Both from and to query params are required when filtering usage",
    };
  }

  if (!isDateOnly(from) || !isDateOnly(to)) {
    return {
      ok: false,
      error: "from and to must be valid dates in YYYY-MM-DD format",
    };
  }

  if (from > to) {
    return {
      ok: false,
      error: "from must be before or equal to to",
    };
  }

  return {
    ok: true,
    range: { from, to },
  };
}

function buildPresetUsageDateRange(
  days: number,
  now: Date,
): PublicUsageDateSelection {
  const to = formatDateOnly(now);
  const fromDate = new Date(now);
  fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1));
  const from = formatDateOnly(fromDate);

  return {
    kind: "preset",
    value: `${days}d`,
    label: `Last ${days} day${days === 1 ? "" : "s"}`,
    range: { from, to },
  };
}

export function parsePublicUsageDate(
  value: string | null,
  now: Date = new Date(),
):
  | { ok: true; selection: PublicUsageDateSelection }
  | { ok: false; error: string } {
  if (value === null) {
    return {
      ok: true,
      selection: {
        kind: "all",
        value: null,
        label: "All time",
        range: null,
      },
    };
  }

  const presetMatch = PRESET_DATE_RANGE_PATTERN.exec(value);
  if (presetMatch) {
    const days = Number.parseInt(presetMatch[1] ?? "", 10);
    if (!Number.isNaN(days) && days > 0) {
      return {
        ok: true,
        selection: buildPresetUsageDateRange(days, now),
      };
    }
  }

  const explicitMatch = EXPLICIT_DATE_RANGE_PATTERN.exec(value);
  if (explicitMatch) {
    const rangeResult = parseUsageDateRange({
      from: explicitMatch[1] ?? null,
      to: explicitMatch[2] ?? null,
    });

    if (!rangeResult.ok || !rangeResult.range) {
      return {
        ok: false,
        error: rangeResult.ok ? "Invalid date range" : rangeResult.error,
      };
    }

    return {
      ok: true,
      selection: {
        kind: "range",
        value,
        label: formatUsageDateRangeLabel(rangeResult.range),
        range: rangeResult.range,
      },
    };
  }

  return {
    ok: false,
    error:
      "date must be a preset like 30d or an explicit range like YYYY-MM-DD..YYYY-MM-DD",
  };
}
