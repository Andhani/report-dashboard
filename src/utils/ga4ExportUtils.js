import { parseGA4DateRange } from "./dateUtils";

/**
 * Header-name aliases for each column GA4 exports may contain. Used to locate
 * columns by name instead of fixed position, so an export with extra/reordered
 * dimension columns (e.g. an added "Page path and screen class" column) doesn't
 * silently shift every downstream index.
 */
export const PAGE_PATH_ALIASES = [/page path/i, /screen class/i];
export const VIEWS_ALIASES = [/views/i];
export const USERS_ALIASES = [/active users/i, /\busers\b/i];
export const SESSIONS_ALIASES = [/sessions/i];
export const AET_ALIASES = [/engagement time/i];
export const KEY_EVENTS_ALIASES = [/key events?/i];
export const SOURCE_MEDIUM_ALIASES = [/session source/i, /source\s*\/\s*medium/i];

/**
 * Scan rows[i][0] for the first cell parseGA4DateRange can parse.
 * Returns the row index, or -1 if none found in the scanned range.
 */
export function findDateRowIndex(rows, maxScan = 15) {
  const limit = Math.min(maxScan, rows.length);
  for (let i = 0; i < limit; i++) {
    if (parseGA4DateRange(String(rows[i]?.[0] ?? "").trim()) !== null) return i;
  }
  return -1;
}

/**
 * First column in headerRow whose (lowercased) text matches any of the given
 * alias regexes. Returns -1 if none match.
 */
export function findColumnIndex(headerRow, aliases) {
  if (!headerRow) return -1;
  for (let c = 0; c < headerRow.length; c++) {
    const text = String(headerRow[c] ?? "").toLowerCase();
    if (!text) continue;
    if (aliases.some((re) => re.test(text))) return c;
  }
  return -1;
}

/**
 * First row (scanning from fromIndex) where every alias group in
 * requiredAliasGroups has at least one matching cell. Returns -1 if none found.
 */
export function findHeaderRowIndex(rows, fromIndex, requiredAliasGroups, maxScan = 10) {
  const limit = Math.min(fromIndex + maxScan, rows.length);
  for (let i = fromIndex; i < limit; i++) {
    const row = rows[i] ?? [];
    const satisfiesAll = requiredAliasGroups.every(
      (aliases) => findColumnIndex(row, aliases) !== -1,
    );
    if (satisfiesAll) return i;
  }
  return -1;
}

/**
 * First row after headerRowIndex containing a cell matching /grand total/i.
 * Falls back to headerRowIndex + 1 (the historical convention) if not found.
 */
export function findTotalRowIndex(rows, headerRowIndex, maxScan = 5) {
  const limit = Math.min(headerRowIndex + 1 + maxScan, rows.length);
  for (let i = headerRowIndex + 1; i < limit; i++) {
    const row = rows[i] ?? [];
    if (row.some((c) => /grand total/i.test(String(c ?? "")))) return i;
  }
  return headerRowIndex + 1;
}

/**
 * Locate the date, header, and grand-total rows of a GA4 export, tolerating
 * shifted banners and reordered/extra columns. Each step falls back to the
 * given fixed index when dynamic detection finds nothing, so files that match
 * today's assumed layout keep resolving to the exact same rows.
 *
 * Returns null only when no date range can be found at all (same bail-out as
 * before this helper existed).
 */
export function parseGA4Preamble(
  rows,
  requiredAliasGroups,
  { fixedDateRow, fixedHeaderRow, fixedTotalRow },
) {
  const dateRowIndex = findDateRowIndex(rows);
  const month = parseGA4DateRange(
    String(rows[dateRowIndex >= 0 ? dateRowIndex : fixedDateRow]?.[0] ?? "").trim(),
  );
  if (!month) return null;

  let headerRowIndex = findHeaderRowIndex(
    rows,
    (dateRowIndex >= 0 ? dateRowIndex : fixedDateRow) + 1,
    requiredAliasGroups,
  );
  if (headerRowIndex === -1) headerRowIndex = fixedHeaderRow;

  const headerRow = rows[headerRowIndex] ?? [];

  let totalRowIndex = findTotalRowIndex(rows, headerRowIndex);
  if (!rows[totalRowIndex]) totalRowIndex = fixedTotalRow;

  return {
    month,
    headerRowIndex,
    headerRow,
    totalRowIndex,
    dataStartIndex: totalRowIndex + 1,
  };
}
