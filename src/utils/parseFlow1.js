import * as XLSX from "xlsx";
import Papa from "papaparse";
import { parseGA4DateRange, urlToSlug, formatMonthKey } from "./dateUtils";

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

/**
 * Main entry point. Auto-detects xlsx vs csv by filename extension.
 * Returns parsed result object or null.
 */
export async function parseFlow1File(arrayBuffer, filename = "") {
  if (filename.toLowerCase().endsWith(".csv")) {
    const text = new TextDecoder("utf-8").decode(arrayBuffer);
    const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const { data: rows } = Papa.parse(clean, { skipEmptyLines: false });
    return tryParseGA4CSV(rows) ?? tryParseGSCCSV(rows);
  }
  const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
  return parseFlow1Workbook(wb);
}

/**
 * Same detection/parsing as parseFlow1File, but takes an already-built
 * SheetJS workbook — used for the "import from Google Sheets" path, where
 * the workbook is reassembled from Sheets API tab values instead of an
 * uploaded .xlsx file.
 */
export function parseFlow1Workbook(wb) {
  const gsc = tryParseGSC(wb);
  if (gsc) return gsc;
  return tryParseGA4(wb);
}

function tryParseGSC(wb) {
  try {
    const filtersName = findFiltersSheet(wb);
    const pagesName = findPagesSheet(wb);
    if (!filtersName || !pagesName) return null;

    // Parse Filters sheet for metadata
    const filterRows = toRows(wb.Sheets[filtersName]);
    let month = null;
    let segment = null;

    for (const row of filterRows) {
      const key = String(row[0] ?? "")
        .trim()
        .toLowerCase();
      const val = String(row[1] ?? "").trim();
      if (key === "date") month = parseGSCDate(val);
      if (key === "page") segment = detectSegment(val);
    }

    if (!month) return null;

    // Parse Pages sheet
    const pageRows = toRows(wb.Sheets[pagesName]);
    const rows = [];
    for (let i = 1; i < pageRows.length; i++) {
      const r = pageRows[i];
      const url = String(r[0] ?? "").trim();
      if (!url.startsWith("http")) continue;
      rows.push({
        slug: urlToSlug(url),
        clicks: toNum(r[1]),
        impressions: toNum(r[2]),
        ctr: toCTR(r[3]),
        rank: toNum(r[4]),
      });
    }

    if (rows.length === 0) return null;

    // Also parse Chart sheet for daily aggregates (used by Traffic Overview reuse path
    // to match the same method as a direct Chart file upload: simple daily average position).
    let chartAgg = null;
    try {
      const chartName = findChartSheet(wb);
      if (chartName) {
        const chartRows = toRows(wb.Sheets[chartName]);
        let cClicks = 0, cImpressions = 0, posWeightedSum = 0;
        for (let i = 1; i < chartRows.length; i++) {
          const r = chartRows[i];
          if (!r[0]) continue;
          cClicks += toNum(r[1]);
          const imp = toNum(r[2]);
          cImpressions += imp;
          const pos = toNum(r[4]);
          // Impression-weighted daily average — faithful to how GSC aggregates position.
          if (pos > 0 && imp > 0) posWeightedSum += pos * imp;
        }
        if (cClicks > 0) {
          chartAgg = {
            clicks: cClicks,
            impressions: cImpressions,
            avgPosition: cImpressions > 0 ? posWeightedSum / cImpressions : 0,
          };
        }
      }
    } catch {
      // chartAgg remains null; aggregation falls back to URL-level rows
    }

    return { type: "gsc", segment: segment ?? "unknown", month, rows, chartAgg };
  } catch {
    return null;
  }
}

function tryParseGA4(wb) {
  try {
    const sheetName = findGA4Sheet(wb);
    if (!sheetName) return null;

    const allRows = toRows(wb.Sheets[sheetName]);

    // Row index 3: "# 20260501-20260531"
    const month = parseGA4DateRange(String(allRows[3]?.[0] ?? "").trim());
    if (!month) return null;

    const project = detectGA4Project(allRows);
    if (!project) return null;

    const rows = [];
    for (let i = 8; i < allRows.length; i++) {
      const r = allRows[i];
      const path = String(r[0] ?? "").trim();
      if (!path.startsWith("/")) continue;
      rows.push({
        slug: path,
        views: toNum(r[1]),
        users: toNum(r[2]),
        sessions: toNum(r[3]),
        aet_seconds: toNum(r[4]),
      });
    }

    if (rows.length === 0) return null;

    // Store grand total row (index 7) so the Traffic Overview reuse path can read
    // exact totals instead of approximating from URL-level averages.
    let grandTotal = null;
    const totRow = allRows[7];
    if (totRow) {
      const totSessions = toNum(totRow[3]);
      if (totSessions > 0) {
        grandTotal = {
          views: toNum(totRow[1]),
          users: toNum(totRow[2]),
          sessions: totSessions,
          aet_seconds: toNum(totRow[4]),
        };
      }
    }

    return { type: "ga4", project, month, rows, grandTotal };
  } catch {
    return null;
  }
}

// ─── CSV parsers ──────────────────────────────────────────────────────────────

function tryParseGA4CSV(rows) {
  // Row index 3: "# 20260501-20260531"
  const month = parseGA4DateRange(String(rows[3]?.[0] ?? "").trim());
  if (!month) return null;

  const project = detectGA4Project(rows);
  if (!project) return null;

  const dataRows = [];
  for (let i = 8; i < rows.length; i++) {
    const r = rows[i];
    const path = String(r[0] ?? "").trim();
    if (!path.startsWith("/")) continue;
    dataRows.push({
      slug: path,
      views: toNum(r[1]),
      users: toNum(r[2]),
      sessions: toNum(r[3]),
      aet_seconds: toNum(r[4]),
    });
  }

  if (dataRows.length === 0) return null;
  return { type: "ga4", project, month, rows: dataRows };
}

function tryParseGSCCSV(rows) {
  // Scan first 15 rows for date range and page filter
  let month = null;
  let segment = null;

  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const cell = String(rows[i]?.[0] ?? "").trim();
    const val1 = String(rows[i]?.[1] ?? "").trim();
    const key = cell.toLowerCase();

    if (key === "date" || key === "dates") month = parseGSCDate(val1);
    if (!month) month = parseGSCDate(cell);
    if (key === "page" || key.includes("filter by page"))
      segment = detectSegment(val1) ?? detectSegment(cell);
  }

  // Parse URL rows (col[0] starts with "http")
  const dataRows = [];
  for (const r of rows) {
    const url = String(r[0] ?? "").trim();
    if (!url.startsWith("http")) continue;
    if (!segment) segment = detectSegment(url);
    dataRows.push({
      slug: urlToSlug(url),
      clicks: toNum(r[1]),
      impressions: toNum(r[2]),
      ctr: toCTR(r[3]),
      rank: toNum(r[4]),
    });
  }

  if (dataRows.length === 0 || !month) return null;
  return { type: "gsc", segment: segment ?? "unknown", month, rows: dataRows };
}

// ─── Storage key helpers ──────────────────────────────────────────────────────

export function getDataKey(result) {
  const mk = formatMonthKey(result.month.year, result.month.month);
  if (result.type === "gsc") {
    if (result.segment === "bc_dijual") return `bc_gsc_dijual_${mk}`;
    if (result.segment === "bc_disewa") return `bc_gsc_disewa_${mk}`;
    if (result.segment === "blog") return `blog_gsc_${mk}`;
  }
  if (result.type === "ga4") {
    if (result.project === "bc_dijual") return `bc_ga4_dijual_${mk}`;
    if (result.project === "bc_disewa") return `bc_ga4_disewa_${mk}`;
    if (result.project === "blog") return `blog_ga4_${mk}`;
  }
  return null;
}

export function formatDetectionLabel(result) {
  const month = new Date(
    result.month.year,
    result.month.month - 1,
  ).toLocaleDateString("en-US", { month: "short", year: "numeric" });

  if (result.type === "gsc") {
    const seg = {
      bc_dijual: "BC GSC Export (/dijual/)",
      bc_disewa: "BC GSC Export (/disewa/)",
      blog: "Blog GSC Export",
      unknown: "GSC Export (unknown segment)",
    };
    return `${seg[result.segment] ?? result.segment} — ${month} (${result.rows.length} URLs)`;
  }
  const projectLabels = {
    bc_dijual: "BC GA4 Export (/dijual/)",
    bc_disewa: "BC GA4 Export (/disewa/)",
    blog: "Blog GA4 Export",
  };
  return `${projectLabels[result.project] ?? result.project} — ${month} (${result.rows.length} URLs)`;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function detectGA4Project(rows) {
  let dijual = 0,
    disewa = 0,
    blog = 0,
    total = 0;
  for (let i = 8; i < rows.length && i < 108; i++) {
    const path = String(rows[i]?.[0] ?? "").trim();
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
  if (dijual > 0) return "bc_dijual";
  if (disewa > 0) return "bc_disewa";
  return "blog";
}

// ─── Sheet-finder helpers (name-based with structural fallback) ───────────────

function findFiltersSheet(wb) {
  const byName = wb.SheetNames.find((n) => /filters/i.test(n));
  if (byName) return byName;
  // Structural fallback: sheet has a "date" row with a parseable GSC date range.
  return (
    wb.SheetNames.find((n) => {
      const rows = toRows(wb.Sheets[n]);
      return rows.some(
        (r) =>
          String(r[0] ?? "").trim().toLowerCase() === "date" &&
          parseGSCDate(String(r[1] ?? "").trim()) !== null,
      );
    }) ?? null
  );
}

function findPagesSheet(wb) {
  const byName = wb.SheetNames.find((n) => /pages/i.test(n));
  if (byName) return byName;
  // Structural fallback: sheet has data rows where col A starts with "http".
  return (
    wb.SheetNames.find((n) => {
      const rows = toRows(wb.Sheets[n]);
      return rows.some((r) => String(r[0] ?? "").trim().startsWith("http"));
    }) ?? null
  );
}

function findChartSheet(wb) {
  const byName = wb.SheetNames.find((n) => /chart/i.test(n));
  if (byName) return byName;
  // Structural fallback: sheet header row contains a "date" column and at least
  // one of clicks / impressions.
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

function findGA4Sheet(wb) {
  // Fast path: any tab whose name contains the free-form pattern (same regex
  // used by buildWorkbookFromSheet in sheetsApi.js).
  const byName = wb.SheetNames.find((n) => /free.?form/i.test(n));
  if (byName) return byName;
  // Structural fallback: tab where row 3 (index 3) holds any recognised GA4
  // date range format (delegates to parseGA4DateRange for format coverage).
  return (
    wb.SheetNames.find((n) => {
      const rows = toRows(wb.Sheets[n]);
      const dateStr = String(rows[3]?.[0] ?? "").trim();
      return parseGA4DateRange(dateStr) !== null;
    }) ?? null
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function toRows(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
}

function toNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function toCTR(v) {
  if (typeof v === "string" && v.includes("%")) return parseFloat(v) / 100;
  return toNum(v);
}

function parseGSCDate(str) {
  // Format A: "1 Jun 2026-30 Jun 2026" (day-first: D MMM YYYY)
  let m = str.match(/\d+\s+([A-Za-z]+)\s+(\d{4})/);
  if (m) {
    const month = MONTH_MAP[m[1].toLowerCase()];
    const year = parseInt(m[2], 10);
    if (month && year) return { year, month };
  }
  // Format B: "May 1, 2026-May 31, 2026" (month-first: MMM D, YYYY)
  m = str.match(/([A-Za-z]+)\s+\d+,?\s+(\d{4})/);
  if (m) {
    const month = MONTH_MAP[m[1].toLowerCase()];
    const year = parseInt(m[2], 10);
    if (month && year) return { year, month };
  }
  // Format C: "2026-06-01 – 2026-06-30" (ISO date range)
  m = str.match(/(\d{4})-(\d{2})-\d{2}/);
  if (m) {
    return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };
  }
  return null;
}

function detectSegment(val) {
  if (val.includes("/dijual/")) return "bc_dijual";
  if (val.includes("/disewa/")) return "bc_disewa";
  if (val.includes("/articles-all/")) return "blog";
  return null;
}
