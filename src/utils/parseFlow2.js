import * as XLSX from "xlsx";
import Papa from "papaparse";
import { parseGA4DateRange, formatMonthKey } from "./dateUtils";

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
    if (!wb.SheetNames.includes("Chart")) return null;

    // Segment from Filters sheet (same logic as Flow 1)
    let segment = "all_organic";
    if (wb.SheetNames.includes("Filters")) {
      const filterRows = XLSX.utils.sheet_to_json(wb.Sheets["Filters"], {
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
    const chartRows = XLSX.utils.sheet_to_json(wb.Sheets["Chart"], {
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
 * Inspect first 100 data rows (index 8+) and return the dominant URL segment
 * ('dijual', 'disewa', 'blog') when ≥50 % of rows share the same path prefix.
 * Returns null for mixed / all-organic files.
 */
function detectGA4Segment(rows) {
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
  const max = Math.max(dijual, disewa, blog);
  if (max === 0 || max / total < 0.5) return null;
  if (dijual === max) return "dijual";
  if (disewa === max) return "disewa";
  return "blog";
}

/**
 * Parse a segment-specific GA4 Free-form export (one segment per file).
 * Reads totals from the grand total row (index 7), same as the all-organic parser.
 * Returns: { type: 'ga4_dijual'|'ga4_disewa'|'ga4_blog', month, views, users, sessions, aet_seconds }
 */
function parseGA4SegmentRows(rows, segment) {
  const month = parseGA4DateRange(String(rows[3]?.[0] ?? "").trim());
  if (!month) return null;

  const totRow = rows[7];
  if (!totRow) return null;

  const views = toNum(totRow[1]);
  const users = toNum(totRow[2]);
  const sessions = toNum(totRow[3]);
  const aet_seconds = toNum(totRow[4]);

  return {
    type: `ga4_${segment}`,
    month,
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
  const month = parseGA4DateRange(String(rows[3]?.[0] ?? "").trim());
  if (!month) return null;

  const totRow = rows[7];
  if (!totRow) return null;

  const views = toNum(totRow[1]);
  const users = toNum(totRow[2]);
  const sessions = toNum(totRow[3]);
  const aet_seconds = toNum(totRow[4]);

  const segmentTotals = { dijual: z(), disewa: z(), blog: z() };

  for (let i = 8; i < rows.length; i++) {
    const r = rows[i];
    const path = String(r[0] ?? "").trim();
    if (!path.startsWith("/")) continue;

    const v = toNum(r[1]),
      u = toNum(r[2]),
      s = toNum(r[3]),
      a = toNum(r[4]);

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
    month,
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
    const sheetName = wb.SheetNames.find(
      (s) =>
        s.toLowerCase().includes("free-form") ||
        s.toLowerCase().includes("freeform"),
    );
    if (!sheetName) return null;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      defval: "",
      raw: true,
    });
    const isLeads =
      String(rows[2]?.[0] ?? "")
        .toLowerCase()
        .includes("leads") ||
      String(rows[6]?.[0] ?? "")
        .toLowerCase()
        .includes("key events");
    if (isLeads) return parseGA4LeadsRows(rows);
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
  const month = parseGA4DateRange(String(rows[3]?.[0] ?? "").trim());
  if (!month) return null;

  const totRow = rows[7];
  if (!totRow) return null;

  const clickContactAgent = toNum(totRow[2]);
  return { type: "ga4_leads", month, clickContactAgent };
}

/**
 * Parse a Flow 2 GA4 Leads export (.csv).
 * Extracts Click_Contact_Agent count from grand total row (index 7).
 * Returns: { type: 'ga4_leads', month, clickContactAgent }
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
    // Distinguish GA4 Free-form vs Leads:
    // Leads report has "Leads" in row 2 OR headers row contains "Key events"
    const lines = text.split("\n");
    const row2 = lines[2] ?? "";
    const row6 = lines[6] ?? "";
    const isLeads =
      row2.toLowerCase().includes("leads") ||
      row6.toLowerCase().includes("key events");
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
  return "Unknown";
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
  // Try "1 May 2026" format
  const m2 = s.match(/\d+\s+([A-Za-z]+)\s+(\d{4})/);
  if (m2) {
    const month = MONTH_MAP[m2[1].toLowerCase()];
    return month ? { year: parseInt(m2[2]), month } : null;
  }
  return null;
}
