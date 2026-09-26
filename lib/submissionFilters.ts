// Shared filter parsing for the admin Submissions panel — used by both
// /api/admin/submissions (paginated table) and /api/admin/export (CSV), so
// "download as Excel" always exports exactly what's on screen, never more.

export type SubmissionStatusFilter = "all" | "paid" | "pending" | "failed";
export type SubmissionRangeFilter = "all" | "24h" | "7d" | "14d" | "1m" | "3m" | "custom";

const STATUS_VALUES: SubmissionStatusFilter[] = ["all", "paid", "pending", "failed"];
const RANGE_VALUES: SubmissionRangeFilter[] = ["all", "24h", "7d", "14d", "1m", "3m", "custom"];

// Lookback window for each quick range, in milliseconds, measured back from
// "now" at request time — "recent" activity, not calendar-aligned buckets.
const RANGE_WINDOW_MS: Partial<Record<SubmissionRangeFilter, number>> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "14d": 14 * 24 * 60 * 60 * 1000,
  "1m": 30 * 24 * 60 * 60 * 1000,
  "3m": 90 * 24 * 60 * 60 * 1000,
};

// Accepts "YYYY-MM-DD" (what <input type="date"> sends) only — anything
// else is treated as absent rather than guessed at.
function parseDateOnly(value: string | null): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface ResolvedSubmissionFilters {
  status: SubmissionStatusFilter;
  range: SubmissionRangeFilter;
  from: string | null; // echoed back for the UI, "YYYY-MM-DD"
  to: string | null;
  where: {
    paymentStatus?: string;
    createdAt?: { gte?: Date; lte?: Date };
  };
}

// Reads status/range/from/to off the query string and turns them into a
// Prisma-ready `where` clause. Unknown/malformed values fall back to safe
// defaults ("all") instead of erroring — a bad query param should never 500
// an admin out of their own dashboard.
export function resolveSubmissionFilters(searchParams: URLSearchParams): ResolvedSubmissionFilters {
  const statusRaw = (searchParams.get("status") || "all").toLowerCase();
  const status = (STATUS_VALUES as string[]).includes(statusRaw) ? (statusRaw as SubmissionStatusFilter) : "all";

  const rangeRaw = (searchParams.get("range") || "all").toLowerCase();
  const range = (RANGE_VALUES as string[]).includes(rangeRaw) ? (rangeRaw as SubmissionRangeFilter) : "all";

  const where: ResolvedSubmissionFilters["where"] = {};
  if (status !== "all") where.paymentStatus = status;

  let fromOut: string | null = null;
  let toOut: string | null = null;

  if (range === "custom") {
    let fromDate = parseDateOnly(searchParams.get("from"));
    let toDate = parseDateOnly(searchParams.get("to"));
    // A reversed range (from after to) is swapped rather than rejected —
    // whichever end the admin dragged first, the result is still sensible.
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      [fromDate, toDate] = [toDate, fromDate];
    }
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) {
        where.createdAt.gte = fromDate;
        fromOut = fromDate.toISOString().slice(0, 10);
      }
      if (toDate) {
        // Inclusive of the whole "to" day.
        where.createdAt.lte = new Date(toDate.getTime() + 24 * 60 * 60 * 1000 - 1);
        toOut = toDate.toISOString().slice(0, 10);
      }
    }
  } else if (range in RANGE_WINDOW_MS) {
    where.createdAt = { gte: new Date(Date.now() - RANGE_WINDOW_MS[range]!) };
  }

  return { status, range, from: fromOut, to: toOut, where };
}
