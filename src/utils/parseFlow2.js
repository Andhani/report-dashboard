import * as XLSX from "xlsx";
import Papa from "papaparse";
import { formatMonthKey, urlToSlug } from "./dateUtils";
import {
  PAGE_PATH_ALIASES,
  LANDING_PAGE_ALIASES,
  VIEWS_ALIASES,
  USERS_ALIASES,
  SESSIONS_ALIASES,
  AET_ALIASES,
  EVENT_COUNT_ALIASES,
  findDateRowIndex,
  findColumnIndex,
  parseGA4Preamble,
} from "./ga4ExportUtils";
import {
  SPLITTABLE_SEGMENTS,
  SEGMENTS_BY_ID,
  ENTRY_SEGMENTS,
  detectSegmentFromPaths,
  detectGSCSegment,
} from "./flow2Segments";

const TRAFFIC_ALIAS_GROUPS = [VIEWS_ALIASES, SESSIONS_ALIASES];
const EVENT_ALIAS_GROUPS = [EVENT_COUNT_ALIASES];
const FIXED_ROWS = { fixedDateRow: 3, fixedHeaderRow: 6, fixedTotalRow: 7 };

const MONTH_MAP = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
  // Indonesian month names. GA4/GSC emit these when the account locale is
  // Indonesian. Every spelling shared with English means the same month, so
  // one table serves both languages and no locale flag is needed.
  januari: 1,
  februari: 2,
  peb: 2,
  maret: 3,
  mei: 5,
  juni: 6,
  juli: 7,
  agustus: 8,
  agu: 8,
  ags: 8,
  oktober: 10,
  okt: 10,
  nopember: 11,
  nop: 11,
  desember: 12,
  des: 12,
};

// ─── GSC Chart sheet (.xlsx) ──────────────────────────────────────────────────

/**
 * Parse a Flow 2 GSC Chart workbook.
 * Returns: { type: 'gsc_chart', segment, month, clicks, impressions, avgPosition }
 */
export function parseGSCChartWorkbook(wb) {
  try {
    const chartName = findChartSheet(wb);
    if (!chartName) return null;

    // Segment from the Page filter, falling back to the export's own URLs
    // (same resolution as Flow 1). An export with no Page filter at all is
    // the unfiltered one, which is the grand total. A filter that neither it
    // nor the URLs can place leaves this null: the file is still reported as
    // a GSC export, it just gets no storage key, so it is skipped loudly
    // rather than landing silently on another segment's block.
    const pageFilter = readPageFilter(wb);
    const segment = pageFilter
      ? detectGSCSegment(pageFilter, readPagePaths(wb))
      : "all_organic";

    // Parse Chart sheet: headers in row 0, data in row 1+
    // Columns: Date | Clicks | Impressions | CTR | Position
    const chartRows = XLSX.utils.sheet_to_json(wb.Sheets[chartName], {
      header: 1,
      defval: "",
      raw: true,
    });

    // Month from first data row's Date value
    let month = null;
    let minDay = null;
    let maxDay = null;
    let totalClicks = 0;
    let totalImpressions = 0;
    let posWeightedSum = 0; // sum(position * daily_impressions) for impression-weighted avg

    for (let i = 1; i < chartRows.length; i++) {
      const r = chartRows[i];
      const dateVal = r[0];
      if (!dateVal) continue;

      // Parse date (SheetJS may return a serial number or a string like "2026-05-01")
      const parsed = extractMonthFromDate(dateVal);
      if (!month) month = parsed;
      if (parsed?.day) {
        minDay = minDay === null ? parsed.day : Math.min(minDay, parsed.day);
        maxDay = maxDay === null ? parsed.day : Math.max(maxDay, parsed.day);
      }

      totalClicks += toNum(r[1]);
      const imp = toNum(r[2]);
      totalImpressions += imp;
      // r[3] = CTR (not used in Flow 2 overview)
      // Impression-weighted daily average — faithful to how GSC aggregates position.
      const pos = toNum(r[4]);
      if (pos > 0 && imp > 0) posWeightedSum += pos * imp;
    }

    if (!month || totalClicks === 0) return null;

    return {
      type: "gsc_chart",
      segment,
      month,
      days: minDay === null ? null : { start: minDay, end: maxDay },
      clicks: totalClicks,
      impressions: totalImpressions,
      avgPosition: totalImpressions > 0 ? posWeightedSum / totalImpressions : 0,
    };
  } catch {
    return null;
  }
}

// ─── GA4 exports (.csv / .xlsx) ───────────────────────────────────────────────
//
// Four shapes reach this file, and all four are told apart by their header row
// rather than by name, because the report titles are hand-written in GA4 and
// vary month to month:
//
//   dimension  | metrics                                   | feeds
//   -----------|-------------------------------------------|---------------------
//   Page path  | Views, Active users, Sessions, AET        | main table, traffic
//   Page path  | Active users, Sessions, Event count       | main table, events
//   Landing pg | Views, Active users, Sessions, AET        | Via Entry, traffic
//   Landing pg | Active users, Sessions, Event count       | Via Entry, events
//
// Each may be filtered to one segment or cover everything; a mixed file is
// split by URL so the per-segment blocks still fill in.

/**
 * Start and end day of an export's date range, e.g. "# 20260901-20260918"
 * → { start: 1, end: 18 }. Used to label a partial month in the sheet the way
 * the report does ("Sep (1-18)"). Returns null for a format it can't read, in
 * which case the month is simply labelled without a day range.
 */
function parseDayRange(text) {
  const s = String(text ?? "")
    .replace(/^#\s*/, "")
    .trim();
  const dash = "\\s*[-\u2013\u2014]\\s*";

  let m = s.match(new RegExp(`^(\\d{8})${dash}(\\d{8})$`));
  if (m) return { start: +m[1].slice(6, 8), end: +m[2].slice(6, 8) };

  m = s.match(
    new RegExp(`^\\d{4}-\\d{2}-(\\d{2})${dash}\\d{4}-\\d{2}-(\\d{2})$`),
  );
  if (m) return { start: +m[1], end: +m[2] };

  m = s.match(
    new RegExp(
      `^(\\d{1,2})\\s+[A-Za-z]+\\s+\\d{4}${dash}(\\d{1,2})\\s+[A-Za-z]+\\s+\\d{4}$`,
    ),
  );
  if (m) return { start: +m[1], end: +m[2] };

  m = s.match(
    new RegExp(
      `^[A-Za-z]+\\s+(\\d{1,2}),?\\s+\\d{4}${dash}[A-Za-z]+\\s+(\\d{1,2}),?\\s+\\d{4}$`,
    ),
  );
  if (m) return { start: +m[1], end: +m[2] };

  return null;
}

/** The report title lines GA4 writes above the data (rows 0-5, column A). */
function reportTitleText(rows) {
  const parts = [];
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    parts.push(String(rows[i]?.[0] ?? ""));
  }
  return parts.join(" ");
}

/**
 * Locate the preamble, decide whether this is a traffic or an event export,
 * and resolve every column index by header name.
 * Returns null when the file isn't a recognisable GA4 export.
 */
function classifyGA4Rows(rows) {
  let pre = parseGA4Preamble(rows, TRAFFIC_ALIAS_GROUPS, FIXED_ROWS);
  let kind = "traffic";

  // parseGA4Preamble falls back to the historical fixed header row when the
  // alias groups match nothing, so confirm Views really is there before
  // trusting the traffic reading — an event export has no Views column.
  if (!pre || findColumnIndex(pre.headerRow, VIEWS_ALIASES) === -1) {
    const eventPre = parseGA4Preamble(rows, EVENT_ALIAS_GROUPS, FIXED_ROWS);
    if (
      eventPre &&
      findColumnIndex(eventPre.headerRow, EVENT_COUNT_ALIASES) !== -1
    ) {
      pre = eventPre;
      kind = "event";
    } else if (!pre) {
      return null;
    }
  }

  const landingCol = findColumnIndex(pre.headerRow, LANDING_PAGE_ALIASES);
  const pathCol = findColumnIndex(pre.headerRow, PAGE_PATH_ALIASES);
  // "Landing page + query string" is the Via Entry dimension; anything else
  // with a URL column is a page-path export.
  const dimension = landingCol !== -1 ? "entry" : "path";
  let dimensionCol = landingCol !== -1 ? landingCol : pathCol;
  if (dimensionCol === -1) dimensionCol = 0;

  return {
    kind,
    dimension,
    pre,
    cols: {
      dimension: dimensionCol,
      views: findColumnIndex(pre.headerRow, VIEWS_ALIASES),
      users: findColumnIndex(pre.headerRow, USERS_ALIASES),
      sessions: findColumnIndex(pre.headerRow, SESSIONS_ALIASES),
      aet: findColumnIndex(pre.headerRow, AET_ALIASES),
      eventCount: findColumnIndex(pre.headerRow, EVENT_COUNT_ALIASES),
    },
  };
}

/** Read one row's metrics, leaving out columns this export doesn't have. */
function readMetrics(row, cols, kind) {
  if (kind === "event") {
    return {
      users: toNum(row[cols.users]),
      sessions: toNum(row[cols.sessions]),
      eventCount: toNum(row[cols.eventCount]),
    };
  }
  return {
    views: toNum(row[cols.views]),
    users: toNum(row[cols.users]),
    sessions: toNum(row[cols.sessions]),
    aet_seconds: toNum(row[cols.aet]),
  };
}

function zeroTotals(kind) {
  return kind === "event"
    ? { users: 0, sessions: 0, eventCount: 0 }
    : { views: 0, users: 0, sessions: 0, aetWeighted: 0, aet_seconds: 0 };
}

function addMetrics(acc, m, kind) {
  acc.users += m.users;
  acc.sessions += m.sessions;
  if (kind === "event") {
    acc.eventCount += m.eventCount;
    return;
  }
  acc.views += m.views;
  // "Average engagement time per session" is a per-session average, so rolling
  // several URLs into one segment means weighting by sessions — an unweighted
  // mean would let a one-session page count as much as a thousand-session one.
  if (m.aet_seconds > 0 && m.sessions > 0) {
    acc.aetWeighted += m.aet_seconds * m.sessions;
  }
}

function finishTotals(acc, kind) {
  if (kind === "event") return acc;
  return {
    views: acc.views,
    users: acc.users,
    sessions: acc.sessions,
    aet_seconds: acc.sessions > 0 ? acc.aetWeighted / acc.sessions : 0,
  };
}

/**
 * Parse any GA4 export into a stored entry.
 *
 * A segment-filtered file stores the grand total as-is. A mixed file stores
 * the grand total as `all_organic` plus a per-segment split built from the URL
 * rows, so one all-segments export still fills several blocks.
 */
function parseGA4Rows(rows) {
  const info = classifyGA4Rows(rows);
  if (!info) return null;
  const { kind, dimension, pre, cols } = info;

  const totalRow = rows[pre.totalRowIndex];
  if (!totalRow) return null;

  const paths = [];
  for (let i = pre.dataStartIndex; i < rows.length; i++) {
    const v = rows[i]?.[cols.dimension];
    if (v !== undefined && v !== null && String(v).trim())
      paths.push(String(v));
  }

  const segment = detectSegmentFromPaths(paths, reportTitleText(rows));
  const total = readMetrics(totalRow, cols, kind);

  const dateRowIndex = findDateRowIndex(rows);
  const base = {
    type: `ga4_${dimension === "entry" ? "entry_" : ""}${kind === "event" ? "event" : "traffic"}`,
    dimension,
    month: pre.month,
    days: parseDayRange(rows[dateRowIndex >= 0 ? dateRowIndex : 3]?.[0]),
    segment,
  };

  if (segment) return { ...base, ...total };

  // Mixed export — split the URL rows across every segment whose rule they
  // match. Rules overlap on purpose (a viewdetail page counts towards the
  // whole /perumahan-baru/ area too), so a row can land in more than one.
  const buckets = {};
  const targets =
    dimension === "entry"
      ? ENTRY_SEGMENTS.map((e) => ({
          id: e.id,
          match: SEGMENTS_BY_ID[e.base].match,
        }))
      : SPLITTABLE_SEGMENTS.map((seg) => ({ id: seg.id, match: seg.match }));
  for (const t of targets) buckets[t.id] = zeroTotals(kind);

  for (let i = pre.dataStartIndex; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const path = String(row[cols.dimension] ?? "").trim();
    if (!path.startsWith("/")) continue;
    const m = readMetrics(row, cols, kind);
    for (const t of targets) {
      if (t.match(path)) addMetrics(buckets[t.id], m, kind);
    }
  }

  const segments = {};
  for (const t of targets) segments[t.id] = finishTotals(buckets[t.id], kind);

  return { ...base, all_organic: total, segments };
}

/** Parse a Flow 2 GA4 export (.csv) — traffic or event, page path or entry. */
export function parseGA4File(csvText) {
  const rows = Papa.parse(csvText, { skipEmptyLines: false }).data;
  return parseGA4Rows(rows);
}

/** Parse a Flow 2 GA4 export (.xlsx workbook). */
export function parseGA4Workbook(wb) {
  try {
    const sheetName = findGA4Sheet(wb);
    if (!sheetName) return null;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      defval: "",
      raw: true,
    });
    return parseGA4Rows(rows);
  } catch {
    return null;
  }
}

// ─── Auto-detect from file content ───────────────────────────────────────────

/**
 * Main entry: detect file type and parse.
 * Handles .xlsx (GSC Chart or GA4 Free-form) and .csv (GA4 Free-form or Leads).
 */
export async function parseFlow2File(file, arrayBuffer) {
  const name = file.name.toLowerCase();

  if (name.endsWith(".xlsx")) {
    const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
    return parseGSCChartWorkbook(wb) ?? parseGA4Workbook(wb);
  }

  if (name.endsWith(".csv")) {
    // Strip UTF-8 BOM if present
    const raw = new TextDecoder("utf-8").decode(arrayBuffer);
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    return parseGA4File(text);
  }

  return null;
}

// ─── Storage key helpers ──────────────────────────────────────────────────────

export function getFlow2DataKey(result) {
  const mk = formatMonthKey(result.month.year, result.month.month);

  if (result.type === "gsc_chart")
    return result.segment ? `gsc_${result.segment}_${mk}` : null;

  // Via Entry (landing-page) exports live under their own prefix so they never
  // collide with the page-path export for the same segment.
  if (result.type === "ga4_entry_traffic")
    return result.segment
      ? `ga4_entry_${result.segment}_${mk}`
      : `ga4_entry_free_${mk}`;
  if (result.type === "ga4_entry_event")
    return result.segment
      ? `ga4_entry_leads_${result.segment}_${mk}`
      : `ga4_entry_leads_free_${mk}`;

  // Page-path exports. The all-segments keys (`ga4_free_`, `ga4_leads_`) and
  // the per-segment ones are the same keys earlier versions wrote, so an
  // account's existing imports keep resolving.
  if (result.type === "ga4_traffic")
    return result.segment ? `ga4_${result.segment}_${mk}` : `ga4_free_${mk}`;
  if (result.type === "ga4_event")
    return result.segment
      ? `ga4_leads_${result.segment}_${mk}`
      : `ga4_leads_${mk}`;

  return null;
}

export function formatFlow2DetectionLabel(result) {
  const month = new Date(
    result.month.year,
    result.month.month - 1,
  ).toLocaleDateString("en-US", { month: "short", year: "numeric" });

  if (result.type === "gsc_chart") {
    const seg = SEGMENTS_BY_ID[result.segment];
    const where = seg ? seg.short : "segment not identified";
    return `GSC Export (${where}) — ${month} · ${result.clicks.toLocaleString()} clicks`;
  }

  const isEntry = result.dimension === "entry";
  const isEvent = result.type.endsWith("event");
  const kind = `${isEntry ? "Via Entry " : ""}${isEvent ? "Event " : ""}GA4 Export`;
  const where = result.segment
    ? (SEGMENTS_BY_ID[result.segment]?.short ?? result.segment)
    : "All Segments";

  const figure = result.segment
    ? isEvent
      ? `${result.eventCount.toLocaleString()} events`
      : `${result.views.toLocaleString()} views`
    : isEvent
      ? `${result.all_organic.eventCount.toLocaleString()} events`
      : `${result.all_organic.views.toLocaleString()} views`;

  return `${kind} (${where}) — ${month} · ${figure}`;
}

// ─── Sheet-finder helpers (name-based with structural fallback) ───────────────

/** The Filters sheet's `Page` value, or null when the export is unfiltered. */
function readPageFilter(wb) {
  const name = findFiltersSheet(wb);
  if (!name) return null;
  const rows = toRows(wb.Sheets[name]);
  for (const row of rows) {
    const key = String(row[0] ?? "")
      .trim()
      .toLowerCase();
    if (key !== "page") continue;
    const val = String(row[1] ?? "").trim();
    if (val) return val;
  }
  return null;
}

/** Site-relative paths of the Pages sheet's URLs, for segment detection. */
function readPagePaths(wb) {
  const name = findPagesSheet(wb);
  if (!name) return [];
  const paths = [];
  for (const row of toRows(wb.Sheets[name])) {
    const url = String(row[0] ?? "").trim();
    if (url.startsWith("http")) paths.push(urlToSlug(url));
  }
  return paths;
}

function findPagesSheet(wb) {
  const byName = wb.SheetNames.find((n) => /pages/i.test(n));
  if (byName) return byName;
  // Structural fallback: sheet has data rows where col A starts with "http".
  return (
    wb.SheetNames.find((n) =>
      toRows(wb.Sheets[n]).some((r) =>
        String(r[0] ?? "")
          .trim()
          .startsWith("http"),
      ),
    ) ?? null
  );
}

function toRows(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
}

function findChartSheet(wb) {
  const byName = wb.SheetNames.find((n) => /chart/i.test(n));
  if (byName) return byName;
  // Structural fallback: header row has a "date" column + clicks/impressions.
  return (
    wb.SheetNames.find((n) => {
      const rows = toRows(wb.Sheets[n]);
      if (rows.length < 2) return false;
      const headers = (rows[0] ?? []).map((h) => String(h ?? "").toLowerCase());
      return (
        headers.some((h) => h === "date") &&
        headers.some((h) => h.includes("click") || h.includes("impression"))
      );
    }) ?? null
  );
}

function findFiltersSheet(wb) {
  const byName = wb.SheetNames.find((n) => /filters/i.test(n));
  if (byName) return byName;
  // Structural fallback: sheet has a "date" row (col A) with a non-empty value (col B).
  return (
    wb.SheetNames.find((n) => {
      const rows = toRows(wb.Sheets[n]);
      return rows.some(
        (r) =>
          String(r[0] ?? "")
            .trim()
            .toLowerCase() === "date" && String(r[1] ?? "").trim().length > 0,
      );
    }) ?? null
  );
}

function findGA4Sheet(wb) {
  // Fast path: any tab whose name contains the free-form or events pattern.
  const byName = wb.SheetNames.find((n) => /free.?form|events?/i.test(n));
  if (byName) return byName;
  // Structural fallback: tab where any of the first few rows holds a
  // recognised GA4 date range (delegates to parseGA4DateRange for format
  // coverage, and scans instead of assuming a fixed row so a shifted banner
  // still resolves).
  return (
    wb.SheetNames.find((n) => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], {
        header: 1,
        defval: "",
        raw: true,
      });
      return findDateRowIndex(rows) !== -1;
    }) ?? null
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function extractMonthFromDate(dateVal) {
  // SheetJS may give a date serial (number) or ISO string "2026-05-01"
  if (typeof dateVal === "number") {
    // Excel date serial: days since 1900-01-01
    const d = XLSX.SSF.parse_date_code(dateVal);
    if (d) return { year: d.y, month: d.m, day: d.d };
  }
  const s = String(dateVal);
  const m =
    s.match(/^(\d{4})-(\d{2})-(\d{2})/) || s.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (m)
    return { year: parseInt(m[1]), month: parseInt(m[2]), day: parseInt(m[3]) };
  // Day-first: "1 May 2026"
  const m2 = s.match(/(\d+)\s+([A-Za-z]+)\s+(\d{4})/);
  if (m2) {
    const month = MONTH_MAP[m2[2].toLowerCase()];
    if (month) return { year: parseInt(m2[3]), month, day: parseInt(m2[1]) };
  }
  // Month-first: "May 1, 2026"
  const m3 = s.match(/([A-Za-z]+)\s+(\d+),?\s+(\d{4})/);
  if (m3) {
    const month = MONTH_MAP[m3[1].toLowerCase()];
    if (month) return { year: parseInt(m3[3]), month, day: parseInt(m3[2]) };
  }
  return null;
}
