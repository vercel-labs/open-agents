export interface UsageDateRange {
  from: string;
  to: string;
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function formatDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
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
