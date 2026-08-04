import * as XLSX from "xlsx";
import Papa from "papaparse";
import { formatMonthKey } from "./dateUtils";
import {
  PAGE_PATH_ALIASES,
  VIEWS_ALIASES,
  USERS_ALIASES,
  SESSIONS_ALIASES,
  AET_ALIASES,
  KEY_EVENTS_ALIASES,
  findDateRowIndex,
  findColumnIndex,
  parseGA4Preamble,
} from "./ga4ExportUtils";

const FREE_FORM_ALIAS_GROUPS = [VIEWS_ALIASES, SESSIONS_ALIASES];
const LEADS_ALIAS_GROUPS = [KEY_EVENTS_ALIASES];
const FIXED_ROWS = { fixedDateRow: 3, fixedHeaderRow: 6, fixedTotalRow: 7 };

/**
 * True if any of the first ~15 rows contains a cell naming this a Leads/Event
 * report ("Leads" or "Key events"). Scans a range rather than fixed rows 2/6
 * so a shifted banner or extra dimension column doesn't defeat detection.
 */
function isLeadsExport(rows) {
  const scanLimit = Math.min(15, rows.length);
  for (let i = 0; i < scanLimit; i++) {
    if (findColumnIndex(rows[i] ?? [], [/leads/i, ...KEY_EVENTS_ALIASES]) !== -1)
      return true;
  }
  return false;
}

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
  oct: 10,
  nov: 11,
  dec: 12,
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

    // Segment from Filters sheet (same logic as Flow 1)
    let segment = "all_organic";
    const filtersName = findFiltersSheet(wb);
    if (filtersName) {
      const filterRows = XLSX.utils.sheet_to_json(wb.Sheets[filtersName], {
        header: 1,
        defval: "",
        raw: true,
      });
      for (const row of filterRows) {
        const key = String(row[0] ?? "")
          .trim()
          .toLowerCase();
        const val = String(row[1] ?? "").trim();
        if (key === "page") {
          if (val.includes("/dijual/")) {
            segment = "dijual";
            break;
          }
          if (val.includes("/disewa/")) {
            segment = "disewa";
            break;
          }
          if (val.includes("/articles-all/")) {
            segment = "blog";
            break;
          }
        }
      }
    }

    // Parse Chart sheet: headers in row 0, data in row 1+
    // Columns: Date | Clicks | Impressions | CTR | Position
    const chartRows = XLSX.utils.sheet_to_json(wb.Sheets[chartName], {
      header: 1,
      defval: "",
      raw: true,
    });

    // Month from first data row's Date value
    let month = null;
    let totalClicks = 0;
    let totalImpressions = 0;
    let posWeightedSum = 0; // sum(position * daily_impressions) for impression-weighted avg

    for (let i = 1; i < chartRows.length; i++) {
      const r = chartRows[i];
      const dateVal = r[0];
      if (!dateVal) continue;

      // Parse date (SheetJS may return a serial number or a string like "2026-05-01")
      if (!month) month = extractMonthFromDate(dateVal);

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
      clicks: totalClicks,
      impressions: totalImpressions,
      avgPosition: totalImpressions > 0 ? posWeightedSum / totalImpressions : 0,
    };
  } catch {
    return null;
  }
}

// ─── GA4 Free-form export (.csv / .xlsx) ─────────────────────────────────────

/**
 * Scan rows[dataStartIndex..] for the single URL segment ('dijual', 'disewa',
 * 'blog') present in the sample, if only one is. Returns null when there's no
 * usable path column, too few path rows, or more than one segment present
 * (mixed / all-organic file).
 */
function scanSingleSegment(rows, dataStartIndex, pathCol) {
  if (pathCol === -1) return null;

  let dijual = 0,
    disewa = 0,
    blog = 0,
    total = 0;
  const scanLimit = Math.min(rows.length, dataStartIndex + 100);
  for (let i = dataStartIndex; i < scanLimit; i++) {
    const path = String(rows[i]?.[pathCol] ?? "").trim();
    if (!path.startsWith("/")) continue;
    total++;
    if (path.includes("/dijual/")) dijual++;
    else if (path.includes("/disewa/")) disewa++;
    else if (path.includes("/articles-all/")) blog++;
  }
  if (total < 3) return null;
  // A segment-filtered GA4 export only ever contains paths from ONE segment
  // (GA4's page-path filter excludes the rest). If more than one segment has
  // real presence in the sample, this is an All Segments / mixed export, not
  // a single-segment file — regardless of which segment has the most rows
  // (long-tail blog URLs can outnumber BC's aggregated property paths by row
  // count alone).
  const present = [dijual, disewa, blog].filter((c) => c > 0).length;
  if (present !== 1) return null;
  if (dijual > 0) return "dijual";
  if (disewa > 0) return "disewa";
  return "blog";
}

/**
 * Inspect first 100 data rows (index 8+) and return the single URL segment
 * ('dijual', 'disewa', 'blog') that is present, if only one is. Returns null
 * for mixed / all-organic files.
 */
function detectGA4Segment(rows) {
  const pre = parseGA4Preamble(rows, FREE_FORM_ALIAS_GROUPS, FIXED_ROWS);
  const dataStartIndex = pre ? pre.dataStartIndex : 8;
  let pathCol = pre ? findColumnIndex(pre.headerRow, PAGE_PATH_ALIASES) : -1;
  if (pathCol === -1) pathCol = 0;
  return scanSingleSegment(rows, dataStartIndex, pathCol);
}

/**
 * Same idea as detectGA4Segment but for GA4 Leads/Key events exports, which
 * have no Views/Sessions columns to anchor the header row on. Unlike
 * detectGA4Segment, an unresolved path column means the export has no
 * per-URL breakdown at all (e.g. the per-date Key events layout) — there's
 * no column-0 fallback here, since guessing wrong would misattribute leads
 * to the wrong segment rather than just to the wrong URL.
 */
function detectLeadsSegment(rows) {
  const pre = parseGA4Preamble(rows, LEADS_ALIAS_GROUPS, FIXED_ROWS);
  const dataStartIndex = pre ? pre.dataStartIndex : 8;
  const pathCol = pre ? findColumnIndex(pre.headerRow, PAGE_PATH_ALIASES) : -1;
  return scanSingleSegment(rows, dataStartIndex, pathCol);
}

/**
 * Parse a segment-specific GA4 Free-form export (one segment per file).
 * Reads totals from the grand total row (index 7), same as the all-organic parser.
 * Returns: { type: 'ga4_dijual'|'ga4_disewa'|'ga4_blog', month, views, users, sessions, aet_seconds }
 */
function parseGA4SegmentRows(rows, segment) {
  const pre = parseGA4Preamble(rows, FREE_FORM_ALIAS_GROUPS, FIXED_ROWS);
  if (!pre) return null;

  const totRow = rows[pre.totalRowIndex];
  if (!totRow) return null;

  let viewsCol = findColumnIndex(pre.headerRow, VIEWS_ALIASES);
  if (viewsCol === -1) viewsCol = 1;
  let usersCol = findColumnIndex(pre.headerRow, USERS_ALIASES);
  if (usersCol === -1) usersCol = 2;
  let sessionsCol = findColumnIndex(pre.headerRow, SESSIONS_ALIASES);
  if (sessionsCol === -1) sessionsCol = 3;
  let aetCol = findColumnIndex(pre.headerRow, AET_ALIASES);
  if (aetCol === -1) aetCol = 4;

  const views = toNum(totRow[viewsCol]);
  const users = toNum(totRow[usersCol]);
  const sessions = toNum(totRow[sessionsCol]);
  const aet_seconds = toNum(totRow[aetCol]);

  return {
    type: `ga4_${segment}`,
    month: pre.month,
    views,
    users,
    sessions,
    aet_seconds,
  };
}

/**
 * Core row-level parser for GA4 Free-form exports (all-organic / mixed files).
 * Accepts a 2D array of values (from Papa.parse or SheetJS sheet_to_json).
 * Row layout: index 3 = date range, index 7 = grand total, index 8+ = URL rows.
 */
function parseGA4FreeRows(rows) {
  const pre = parseGA4Preamble(rows, FREE_FORM_ALIAS_GROUPS, FIXED_ROWS);
  if (!pre) return null;

  const totRow = rows[pre.totalRowIndex];
  if (!totRow) return null;

  let pathCol = findColumnIndex(pre.headerRow, PAGE_PATH_ALIASES);
  if (pathCol === -1) pathCol = 0;
  let viewsCol = findColumnIndex(pre.headerRow, VIEWS_ALIASES);
  if (viewsCol === -1) viewsCol = 1;
  let usersCol = findColumnIndex(pre.headerRow, USERS_ALIASES);
  if (usersCol === -1) usersCol = 2;
  let sessionsCol = findColumnIndex(pre.headerRow, SESSIONS_ALIASES);
  if (sessionsCol === -1) sessionsCol = 3;
  let aetCol = findColumnIndex(pre.headerRow, AET_ALIASES);
  if (aetCol === -1) aetCol = 4;

  const views = toNum(totRow[viewsCol]);
  const users = toNum(totRow[usersCol]);
  const sessions = toNum(totRow[sessionsCol]);
  const aet_seconds = toNum(totRow[aetCol]);

  const segmentTotals = { dijual: z(), disewa: z(), blog: z() };

  for (let i = pre.dataStartIndex; i < rows.length; i++) {
    const r = rows[i];
    const path = String(r[pathCol] ?? "").trim();
    if (!path.startsWith("/")) continue;

    const v = toNum(r[viewsCol]),
      u = toNum(r[usersCol]),
      s = toNum(r[sessionsCol]),
      a = toNum(r[aetCol]);

    if (path.includes("/dijual/")) {
      segmentTotals.dijual.views += v;
      segmentTotals.dijual.users += u;
      segmentTotals.dijual.sessions += s;
      if (a > 0) {
        segmentTotals.dijual.aetSum += a;
        segmentTotals.dijual.count++;
      }
    } else if (path.includes("/disewa/")) {
      segmentTotals.disewa.views += v;
      segmentTotals.disewa.users += u;
      segmentTotals.disewa.sessions += s;
      if (a > 0) {
        segmentTotals.disewa.aetSum += a;
        segmentTotals.disewa.count++;
      }
    } else if (path.includes("/articles-all/")) {
      segmentTotals.blog.views += v;
      segmentTotals.blog.users += u;
      segmentTotals.blog.sessions += s;
      if (a > 0) {
        segmentTotals.blog.aetSum += a;
        segmentTotals.blog.count++;
      }
    }
  }

  for (const seg of Object.values(segmentTotals)) {
    seg.aet_seconds = seg.count > 0 ? seg.aetSum / seg.count : 0;
  }

  return {
    type: "ga4_free",
    month: pre.month,
    all_organic: { views, users, sessions, aet_seconds },
    dijual: {
      views: segmentTotals.dijual.views,
      users: segmentTotals.dijual.users,
      sessions: segmentTotals.dijual.sessions,
      aet_seconds: segmentTotals.dijual.aet_seconds,
    },
    disewa: {
      views: segmentTotals.disewa.views,
      users: segmentTotals.disewa.users,
      sessions: segmentTotals.disewa.sessions,
      aet_seconds: segmentTotals.disewa.aet_seconds,
    },
    blog: {
      views: segmentTotals.blog.views,
      users: segmentTotals.blog.users,
      sessions: segmentTotals.blog.sessions,
      aet_seconds: segmentTotals.blog.aet_seconds,
    },
  };
}

/**
 * Parse a Flow 2 GA4 Free-form export (.csv).
 * Auto-detects whether the file is segment-specific (dijual / disewa / blog)
 * or all-organic/mixed and routes to the appropriate parser.
 */
export function parseGA4FreeFile(csvText) {
  const rows = Papa.parse(csvText, { skipEmptyLines: false }).data;
  const segment = detectGA4Segment(rows);
  if (segment) return parseGA4SegmentRows(rows, segment);
  return parseGA4FreeRows(rows);
}

/**
 * Parse a Flow 2 GA4 Free-form export (.xlsx workbook).
 * Looks for a sheet whose name contains "free-form" or "freeform".
 */
export function parseGA4FreeWorkbook(wb) {
  try {
    const sheetName = findGA4Sheet(wb);
    if (!sheetName) return null;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      defval: "",
      raw: true,
    });
    if (isLeadsExport(rows)) return parseGA4LeadsRows(rows);
    const segment = detectGA4Segment(rows);
    if (segment) return parseGA4SegmentRows(rows, segment);
    return parseGA4FreeRows(rows);
  } catch {
    return null;
  }
}

// ─── GA4 Leads export (.csv) ──────────────────────────────────────────────────

/**
 * Core row-level parser for GA4 Leads exports.
 * Accepts a 2D array of values (from Papa.parse or SheetJS sheet_to_json).
 */
function parseGA4LeadsRows(rows) {
  const pre = parseGA4Preamble(rows, LEADS_ALIAS_GROUPS, FIXED_ROWS);
  if (!pre) return null;

  const totRow = rows[pre.totalRowIndex];
  if (!totRow) return null;

  let keyEventsCol = findColumnIndex(pre.headerRow, KEY_EVENTS_ALIASES);
  if (keyEventsCol === -1) keyEventsCol = 2;

  const clickContactAgent = toNum(totRow[keyEventsCol]);
  const segment = detectLeadsSegment(rows);
  const type = segment ? `ga4_leads_${segment}` : "ga4_leads";
  return { type, month: pre.month, clickContactAgent };
}

/**
 * Parse a Flow 2 GA4 Leads export (.csv).
 * Extracts Click_Contact_Agent count from grand total row (index 7).
 * Returns: { type: 'ga4_leads' | 'ga4_leads_dijual' | 'ga4_leads_disewa' | 'ga4_leads_blog', month, clickContactAgent }
 */
export function parseGA4LeadsFile(csvText) {
  const rows = Papa.parse(csvText, { skipEmptyLines: false }).data;
  return parseGA4LeadsRows(rows);
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
    return parseGSCChartWorkbook(wb) ?? parseGA4FreeWorkbook(wb);
  }

  if (name.endsWith(".csv")) {
    // Strip UTF-8 BOM if present
    const raw = new TextDecoder("utf-8").decode(arrayBuffer);
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    // Distinguish GA4 Free-form vs Leads: scan the banner/header lines for
    // "Leads" or "Key events" — a wider net than a single fixed line, since
    // banner length and column layout both vary across exports.
    const bannerText = text.split("\n").slice(0, 15).join("\n").toLowerCase();
    const isLeads = /leads/.test(bannerText) || /key events?/.test(bannerText);
    if (isLeads) return parseGA4LeadsFile(text);
    return parseGA4FreeFile(text);
  }

  return null;
}

// ─── Storage key helpers ──────────────────────────────────────────────────────

export function getFlow2DataKey(result) {
  const mk = formatMonthKey(result.month.year, result.month.month);
  if (result.type === "gsc_chart") return `gsc_${result.segment}_${mk}`;
  if (result.type === "ga4_free") return `ga4_free_${mk}`;
  if (result.type === "ga4_dijual") return `ga4_dijual_${mk}`;
  if (result.type === "ga4_disewa") return `ga4_disewa_${mk}`;
  if (result.type === "ga4_blog") return `ga4_blog_${mk}`;
  if (result.type === "ga4_leads") return `ga4_leads_${mk}`;
  if (result.type === "ga4_leads_dijual") return `ga4_leads_dijual_${mk}`;
  if (result.type === "ga4_leads_disewa") return `ga4_leads_disewa_${mk}`;
  if (result.type === "ga4_leads_blog") return `ga4_leads_blog_${mk}`;
  return null;
}

export function formatFlow2DetectionLabel(result) {
  const month = new Date(
    result.month.year,
    result.month.month - 1,
  ).toLocaleDateString("en-US", { month: "short", year: "numeric" });

  const segLabel = {
    all_organic: "GSC Export (All Segments)",
    dijual: "BC GSC Export (/dijual/)",
    disewa: "BC GSC Export (/disewa/)",
    blog: "Blog GSC Export",
  };

  if (result.type === "gsc_chart") {
    return `${segLabel[result.segment] ?? result.segment} — ${month} · ${result.clicks.toLocaleString()} clicks`;
  }
  if (result.type === "ga4_free") {
    return `GA4 Export (All Segments) — ${month} · ${result.all_organic.views.toLocaleString()} total views`;
  }
  if (result.type === "ga4_dijual") {
    return `BC GA4 Export (/dijual/) — ${month} · ${result.views.toLocaleString()} views`;
  }
  if (result.type === "ga4_disewa") {
    return `BC GA4 Export (/disewa/) — ${month} · ${result.views.toLocaleString()} views`;
  }
  if (result.type === "ga4_blog") {
    return `GA4 Export (Blog) — ${month} · ${result.views.toLocaleString()} views`;
  }
  if (result.type === "ga4_leads") {
    return `Event GA4 Export — ${month} · ${result.clickContactAgent.toLocaleString()} Click_Contact_Agent`;
  }
  if (result.type === "ga4_leads_dijual") {
    return `BC Event GA4 Export (/dijual/) — ${month} · ${result.clickContactAgent.toLocaleString()} Click_Contact_Agent`;
  }
  if (result.type === "ga4_leads_disewa") {
    return `BC Event GA4 Export (/disewa/) — ${month} · ${result.clickContactAgent.toLocaleString()} Click_Contact_Agent`;
  }
  if (result.type === "ga4_leads_blog") {
    return `Event GA4 Export (Blog) — ${month} · ${result.clickContactAgent.toLocaleString()} Click_Contact_Agent`;
  }
  return "Unknown";
}

// ─── Sheet-finder helpers (name-based with structural fallback) ───────────────

function findChartSheet(wb) {
  const byName = wb.SheetNames.find((n) => /chart/i.test(n));
  if (byName) return byName;
  // Structural fallback: header row has a "date" column + clicks/impressions.
  return (
    wb.SheetNames.find((n) => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], {
        header: 1,
        defval: "",
        raw: true,
      });
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
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], {
        header: 1,
        defval: "",
        raw: true,
      });
      return rows.some(
        (r) =>
          String(r[0] ?? "").trim().toLowerCase() === "date" &&
          String(r[1] ?? "").trim().length > 0,
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

function z() {
  return {
    views: 0,
    users: 0,
    sessions: 0,
    aetSum: 0,
    count: 0,
    aet_seconds: 0,
  };
}

function extractMonthFromDate(dateVal) {
  // SheetJS may give a date serial (number) or ISO string "2026-05-01"
  if (typeof dateVal === "number") {
    // Excel date serial: days since 1900-01-01
    const d = XLSX.SSF.parse_date_code(dateVal);
    if (d) return { year: d.y, month: d.m };
  }
  const s = String(dateVal);
  const m =
    s.match(/^(\d{4})-(\d{2})-(\d{2})/) || s.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (m) return { year: parseInt(m[1]), month: parseInt(m[2]) };
  // Day-first: "1 May 2026"
  const m2 = s.match(/\d+\s+([A-Za-z]+)\s+(\d{4})/);
  if (m2) {
    const month = MONTH_MAP[m2[1].toLowerCase()];
    if (month) return { year: parseInt(m2[2]), month };
  }
  // Month-first: "May 1, 2026"
  const m3 = s.match(/([A-Za-z]+)\s+\d+,?\s+(\d{4})/);
  if (m3) {
    const month = MONTH_MAP[m3[1].toLowerCase()];
    if (month) return { year: parseInt(m3[2]), month };
  }
  return null;
}
