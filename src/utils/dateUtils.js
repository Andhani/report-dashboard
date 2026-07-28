const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const MONTH_LABELS_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_LABELS_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

/**
 * Parse a month key like "2025-12" → { year: 2025, month: 12 }
 */
export function parseMonthKey(key) {
  const [year, month] = key.split("-").map(Number);
  return { year, month };
}

/**
 * Build a month key from year + 1-based month.
 */
export function formatMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Get N consecutive month slots starting from the given key.
 * Returns array of { key: "2025-12", label: "Dec 2025" }
 */
export function getMonthSlots(startKey, count) {
  const { year, month } = parseMonthKey(startKey);
  const slots = [];
  for (let i = 0; i < count; i++) {
    const totalMonths = (year - 1) * 12 + (month - 1) + i;
    const y = Math.floor(totalMonths / 12) + 1;
    const m = (totalMonths % 12) + 1;
    const key = formatMonthKey(y, m);
    const label = `${MONTH_LABELS[m - 1]} ${y}`;
    slots.push({ key, label, year: y, month: m });
  }
  return slots;
}

const MONTH_NAME_MAP = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7,
  aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse a date range string from GA4 header row.
 * Handles all known GA4/GSC export date formats:
 *   "# 20260501-20260531"   — standard GA4 compact (with or without #)
 *   "2026-05-01 – 2026-05-31" — ISO range (hyphen or en/em dash)
 *   "1 May 2026 – 31 May 2026" — human-readable, day-first
 *   "May 1, 2026 – May 31, 2026" — human-readable, month-first
 * Returns: { year, month } from start date, or null.
 */
export function parseGA4DateRange(str) {
  const s = str.replace(/^#\s*/, "").trim();

  // Compact YYYYMMDD: "20260501-20260531" (hyphen or en/em dash, optional spaces)
  let m = s.match(/^(\d{8})\s*[-–—]\s*\d{8}$/);
  if (m) {
    const start = m[1];
    return { year: parseInt(start.slice(0, 4), 10), month: parseInt(start.slice(4, 6), 10) };
  }

  // ISO range: "2026-05-01 – 2026-05-31"
  m = s.match(/^(\d{4})-(\d{2})-\d{2}\s*[-–—]\s*\d{4}-\d{2}-\d{2}$/);
  if (m) {
    return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };
  }

  // Human-readable, day-first: "1 May 2026"
  m = s.match(/\d+\s+([A-Za-z]+)\s+(\d{4})/);
  if (m) {
    const month = MONTH_NAME_MAP[m[1].toLowerCase()];
    const year = parseInt(m[2], 10);
    if (month && year) return { year, month };
  }

  // Human-readable, month-first: "May 1, 2026"
  m = s.match(/([A-Za-z]+)\s+\d+,?\s+(\d{4})/);
  if (m) {
    const month = MONTH_NAME_MAP[m[1].toLowerCase()];
    const year = parseInt(m[2], 10);
    if (month && year) return { year, month };
  }

  return null;
}

/**
 * Convert seconds (float) to h:mm:ss string.
 * e.g. 90.178 → "0:01:30"
 */
export function secondsToHmmss(seconds) {
  const total = Math.round(Number(seconds) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Format CTR decimal as percentage string.
 * e.g. 0.0322 → "3.2%"
 */
export function formatCTR(val) {
  return `${(Number(val) * 100).toFixed(1)}%`;
}

/**
 * Get Indonesian month name from 1-based month number.
 */
export function getIndonesianMonth(month) {
  return MONTH_LABELS_ID[month - 1] ?? "";
}

/**
 * Strip https://www.brighton.co.id from a full URL → slug.
 */
export function urlToSlug(url) {
  if (!url) return "";
  return url
    .replace(/^https?:\/\/www\.brighton\.co\.id/, "")
    .replace(/^https?:\/\/brighton\.co\.id/, "");
}
