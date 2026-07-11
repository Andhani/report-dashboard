import * as XLSX from "xlsx";
import { getValidToken } from "./googleAuth";

/**
 * Clear all values in a sheet tab.
 */
async function clearSheet(spreadsheetId, sheetName, token) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`'${sheetName}'`)}:clear`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

/**
 * Push Flow 1 data to the report spreadsheet.
 * Clears the destination sheet first, then writes all rows (headers + URL
 * columns + metrics) starting at A1.
 */
export async function pushFlow1ToSheets(spreadsheetId, project, csvRows) {
  const token = await getValidToken();
  if (!token)
    throw new Error("Not connected to Google — go to Settings to connect.");

  const sheetName =
    project === "bc" ? "BC Traffic (Optimized)" : "Blog Traffic (Optimized)";

  await clearSheet(spreadsheetId, sheetName, token);

  const nRows = csvRows.length;
  const nCols = Math.max(...csvRows.map((r) => r.length));
  const range = `'${sheetName}'!A1:${colNum2Letter(nCols)}${nRows}`;

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ range, majorDimension: "ROWS", values: csvRows }),
    },
  );

  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

/**
 * Convert 1-based column number to A1 letter notation.
 * 1→A, 26→Z, 27→AA, 56→BD
 */
function colNum2Letter(n) {
  let result = "";
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

/**
 * Push Flow 3 (Leads Summary) to Google Sheets.
 * Clears the destination sheet first, then writes all rows from A1.
 */
export async function pushFlow3ToSheets(spreadsheetId, csvRows) {
  const token = await getValidToken();
  if (!token)
    throw new Error("Not connected to Google — go to Settings to connect.");

  const sheetName = "Leads Summary";

  await clearSheet(spreadsheetId, sheetName, token);

  const nRows = csvRows.length;
  const nCols = Math.max(...csvRows.map((r) => r.length));
  const range = `'${sheetName}'!A1:${colNum2Letter(nCols)}${nRows}`;

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ range, majorDimension: "ROWS", values: csvRows }),
    },
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

/**
 * Push Flow 2 (Traffic Overview) to Google Sheets.
 * Clears the destination sheet first, then writes all rows from A1.
 * Layout matches buildFlow2CSV: rows = metrics, columns = segments × months.
 */
export async function pushFlow2ToSheets(spreadsheetId, csvRows) {
  const token = await getValidToken();
  if (!token)
    throw new Error("Not connected to Google — go to Settings to connect.");

  const sheetName = "Traffic Overview (BC & Blog)";

  await clearSheet(spreadsheetId, sheetName, token);

  const nRows = csvRows.length;
  const nCols = csvRows[0]?.length ?? 1;
  const range = `'${sheetName}'!A1:${colNum2Letter(nCols)}${nRows}`;

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ range, majorDimension: "ROWS", values: csvRows }),
    },
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

/**
 * Extract spreadsheet ID from a Google Sheets URL.
 */
export function extractSpreadsheetId(url) {
  const m = (url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

// ─── Sheets-as-file-upload helpers (Flow 1 / Flow 2 "paste a link" import) ────
//
// GSC and GA4 both support "Export → Google Sheets" straight from their own
// UI, which preserves the same tab names as the .xlsx/.csv download (Filters,
// Pages, Chart, Free-form 1, ...). These helpers fetch those tabs via the
// Sheets API and reassemble them into the same { SheetNames, Sheets } shape
// SheetJS produces for an uploaded file, so the existing parsers can be
// reused unchanged.

const TAB_PATTERNS = {
  filters: /filters/i,
  pages: /pages/i,
  chart: /chart/i,
  freeform: /free.?form/i,
};
const CANONICAL_TAB_NAMES = {
  filters: "Filters",
  pages: "Pages",
  chart: "Chart",
  freeform: "Free-form 1",
};

async function getSpreadsheetTabNames(sheetId, token) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return (data.sheets || []).map((s) => s.properties.title);
}

async function getTabValues(sheetId, tabName, token) {
  // Open-ended row range ("A:Z" not "A1:Z5000") — a fixed row cap silently
  // truncated any sheet with more rows than the cap.
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`'${tabName}'!A:Z`)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.values || [];
}

async function resolveSheetAccess(sheetUrl) {
  const sheetId = extractSpreadsheetId(sheetUrl);
  if (!sheetId) throw new Error("Could not parse spreadsheet ID from URL.");
  const token = await getValidToken();
  if (!token)
    throw new Error(
      "Not connected to Google — go to Settings → Connect Google first.",
    );
  return { sheetId, token };
}

/**
 * Fetch the tabs matching `wantedKeys` (from TAB_PATTERNS) out of a Google
 * Sheet and rebuild them as a SheetJS-like workbook: { SheetNames, Sheets }.
 * Tabs that aren't found are simply omitted — callers check SheetNames.
 */
export async function buildWorkbookFromSheet(sheetUrl, wantedKeys) {
  const { sheetId, token } = await resolveSheetAccess(sheetUrl);
  const availableTabs = await getSpreadsheetTabNames(sheetId, token);

  const wb = { SheetNames: [], Sheets: {} };
  for (const wantKey of wantedKeys) {
    const match = availableTabs.find((t) => TAB_PATTERNS[wantKey].test(t));
    if (!match) continue;
    const values = await getTabValues(sheetId, match, token);
    const name = CANONICAL_TAB_NAMES[wantKey];
    wb.Sheets[name] = XLSX.utils.aoa_to_sheet(values);
    wb.SheetNames.push(name);
  }
  return wb;
}

/**
 * Fetch a Google Sheet's first tab and return it as CSV text — used for
 * Flow 2's GA4 Free-form / Leads imports, which are parsed as CSV.
 */
export async function fetchFirstTabAsCSV(sheetUrl) {
  const { sheetId, token } = await resolveSheetAccess(sheetUrl);
  const availableTabs = await getSpreadsheetTabNames(sheetId, token);
  const firstTab = availableTabs[0];
  if (!firstTab) throw new Error("Sheet appears empty.");
  const values = await getTabValues(sheetId, firstTab, token);
  return XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(values), {
    blankrows: true,
  });
}
