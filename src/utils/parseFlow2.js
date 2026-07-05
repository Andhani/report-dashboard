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
 * Parse a Flow 2 GSC Chart export (.xlsx).
 * Returns: { type: 'gsc_chart', segment, month, clicks, impressions, avgPosition }
 */
export function parseGSCChartFile(arrayBuffer) {
  const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
  return parseGSCChartWorkbook(wb);
}

/**
 * Same as parseGSCChartFile, but takes an already-built SheetJS workbook —
 * used for the "import from Google Sheets" path.
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
    let positionSum = 0;
    let positionCount = 0;

    for (let i = 1; i < chartRows.length; i++) {
      const r = chartRows[i];
      const dateVal = r[0];
      if (!dateVal) continue;

      // Parse date (SheetJS may return a serial number or a string like "2026-05-01")
      if (!month) month = extractMonthFromDate(dateVal);

      totalClicks += toNum(r[1]);
      totalImpressions += toNum(r[2]);
      // r[3] = CTR (not used in Flow 2 overview)
      const pos = toNum(r[4]);
      if (pos > 0) {
        positionSum += pos;
        positionCount++;
      }
    }

    if (!month || totalClicks === 0) return null;

    return {
      type: "gsc_chart",
      segment,
      month,
      clicks: totalClicks,
      impressions: totalImpressions,
      avgPosition: positionCount > 0 ? positionSum / positionCount : 0,
    };
  } catch {
    return null;
  }
}

// ─── GA4 Free-form export (.csv) ──────────────────────────────────────────────

/**
 * Parse a Flow 2 GA4 Free-form export (.csv).
 * Extracts the grand total row (row index 7) for site-wide totals.
 * Also detects segment from URL patterns in data rows.
 * Returns: { type: 'ga4_free', segment, month, views, users, sessions, aet_seconds }
 */
export function parseGA4FreeFile(csvText) {
  const lines = Papa.parse(csvText, { skipEmptyLines: false }).data;

  // Row index 3: "# 20260501-20260531"
  const month = parseGA4DateRange(String(lines[3]?.[0] ?? "").trim());
  if (!month) return null;

  // Row index 7: grand total
  const totRow = lines[7];
  if (!totRow) return null;

  // grand total row: [empty, views, users, sessions, aet_seconds, "Grand total"]
  const views = toNum(totRow[1]);
  const users = toNum(totRow[2]);
  const sessions = toNum(totRow[3]);
  const aet_seconds = toNum(totRow[4]);

  // Detect segment from data rows (index 8+)
  // Default = all_organic (this file always carries the full site totals)
  // But for Flow 2, the same file is used for all segments — grand total = all_organic
  // Sub-segment values are filtered SUM from per-URL rows
  const segmentTotals = { dijual: z(), disewa: z(), blog: z() };

  for (let i = 8; i < lines.length; i++) {
    const r = lines[i];
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
      segmentTotals.dijual.aetSum += a;
      segmentTotals.dijual.count++;
    } else if (path.includes("/disewa/")) {
      segmentTotals.disewa.views += v;
      segmentTotals.disewa.users += u;
      segmentTotals.disewa.sessions += s;
      segmentTotals.disewa.aetSum += a;
      segmentTotals.disewa.count++;
    } else if (path.includes("/articles-all/")) {
      segmentTotals.blog.views += v;
      segmentTotals.blog.users += u;
      segmentTotals.blog.sessions += s;
      segmentTotals.blog.aetSum += a;
      segmentTotals.blog.count++;
    }
  }

  // Compute avg AET per segment
  for (const seg of Object.values(segmentTotals)) {
    seg.aet_seconds = seg.count > 0 ? seg.aetSum / seg.count : 0;
  }

  return {
    type: "ga4_free",
    month,
    // All organic = grand total row
    all_organic: { views, users, sessions, aet_seconds },
    // Sub-segment totals computed from per-URL rows
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

// ─── GA4 Leads export (.csv) ──────────────────────────────────────────────────

/**
 * Parse a Flow 2 GA4 Leads export (.csv).
 * Extracts Click_Contact_Agent count from grand total row (index 7).
 * Returns: { type: 'ga4_leads', month, clickContactAgent }
 */
export function parseGA4LeadsFile(csvText) {
  const lines = Papa.parse(csvText, { skipEmptyLines: false }).data;

  // Row index 3: "# 20260501-20260531"
  const month = parseGA4DateRange(String(lines[3]?.[0] ?? "").trim());
  if (!month) return null;

  // Grand total row index 7: [empty, empty, count, "Grand total"]
  const totRow = lines[7];
  if (!totRow) return null;

  const clickContactAgent = toNum(totRow[2]);

  return { type: "ga4_leads", month, clickContactAgent };
}

// ─── Auto-detect from file content ───────────────────────────────────────────

/**
 * Main entry: detect file type and parse.
 * Handles .xlsx (GSC Chart) and .csv (GA4 Free-form or Leads).
 */
export async function parseFlow2File(file, arrayBuffer) {
  const name = file.name.toLowerCase();

  if (name.endsWith(".xlsx")) {
    const result = parseGSCChartFile(arrayBuffer);
    return result;
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
  if (result.type === "ga4_leads") return `ga4_leads_${mk}`;
  return null;
}

export function formatFlow2DetectionLabel(result) {
  const month = new Date(
    result.month.year,
    result.month.month - 1,
  ).toLocaleDateString("en-US", { month: "short", year: "numeric" });

  const segLabel = {
    all_organic: "All Organic",
    dijual: "/dijual/",
    disewa: "/disewa/",
    blog: "Blog",
  };

  if (result.type === "gsc_chart") {
    return `GSC Chart (${segLabel[result.segment] ?? result.segment}) — ${month} · ${result.clicks.toLocaleString()} clicks`;
  }
  if (result.type === "ga4_free") {
    return `GA4 Free-form — ${month} · ${result.all_organic.views.toLocaleString()} total views`;
  }
  if (result.type === "ga4_leads") {
    return `GA4 Leads — ${month} · ${result.clickContactAgent.toLocaleString()} Click_Contact_Agent`;
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
