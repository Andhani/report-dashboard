import * as XLSX from "xlsx";
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
 * Main entry point. Tries GSC first (has Filters sheet), then GA4.
 * Returns parsed result object or null.
 */
export async function parseFlow1File(arrayBuffer) {
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
    if (!wb.SheetNames.includes("Filters") || !wb.SheetNames.includes("Pages"))
      return null;

    // Parse Filters sheet for metadata
    const filterRows = toRows(wb.Sheets["Filters"]);
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
    const pageRows = toRows(wb.Sheets["Pages"]);
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

    return { type: "gsc", segment: segment ?? "unknown", month, rows };
  } catch {
    return null;
  }
}

function tryParseGA4(wb) {
  try {
    const sheetName = wb.SheetNames.find(
      (s) =>
        s.toLowerCase().includes("free-form") ||
        s.toLowerCase().includes("freeform"),
    );
    if (!sheetName) return null;

    const allRows = toRows(wb.Sheets[sheetName]);

    // Row index 3: "# 20260501-20260531"
    const month = parseGA4DateRange(String(allRows[3]?.[0] ?? "").trim());
    if (!month) return null;

    // Index 8+: data rows (index 7 = grand total, skip rows without a leading slash)
    let project = null;
    const rows = [];

    for (let i = 8; i < allRows.length; i++) {
      const r = allRows[i];
      const path = String(r[0] ?? "").trim();
      if (!path.startsWith("/")) continue;

      if (!project) {
        if (path.includes("/dijual/") || path.includes("/disewa/"))
          project = "bc";
        else if (path.includes("/articles-all/")) project = "blog";
      }

      rows.push({
        slug: path,
        views: toNum(r[1]),
        users: toNum(r[2]),
        sessions: toNum(r[3]),
        aet_seconds: toNum(r[4]),
      });
    }

    if (!project || rows.length === 0) return null;

    return { type: "ga4", project, month, rows };
  } catch {
    return null;
  }
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
    return `${result.project}_ga4_${mk}`;
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
      bc_dijual: "BC GSC (dijual)",
      bc_disewa: "BC GSC (disewa)",
      blog: "Blog GSC",
      unknown: "GSC (unknown segment)",
    };
    return `${seg[result.segment] ?? result.segment} — ${month} (${result.rows.length} URLs)`;
  }
  return `${result.project === "bc" ? "BC" : "Blog"} GA4 — ${month} (${result.rows.length} URLs)`;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

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
  // "1 May 2026-31 May 2026"
  const m = str.match(/\d+\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  const month = MONTH_MAP[m[1].toLowerCase()];
  const year = parseInt(m[2], 10);
  return month && year ? { year, month } : null;
}

function detectSegment(val) {
  if (val.includes("/dijual/")) return "bc_dijual";
  if (val.includes("/disewa/")) return "bc_disewa";
  if (val.includes("/articles-all/")) return "blog";
  return null;
}
