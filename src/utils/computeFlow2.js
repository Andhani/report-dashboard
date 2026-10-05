import { secondsToHmmss } from "./dateUtils";
import { SEGMENTS, ENTRY_SEGMENTS } from "./flow2Segments";

export { SEGMENTS, ENTRY_SEGMENTS };

/**
 * The twelve rows of a main-table block, in sheet order.
 *
 * `leadPerUser` and `userConvRate` are ratios over the same block's Total
 * Active Users; everything else is read straight out of an export.
 */
export const METRICS = [
  { id: "clicks", label: "Total Clicks (GSC)", source: "gsc" },
  { id: "impressions", label: "Total Impressions (GSC)", source: "gsc" },
  { id: "views", label: "Total Views (GA4)", source: "ga4" },
  { id: "users", label: "Total Active Users (GA4)", source: "ga4" },
  { id: "sessions", label: "Total Sessions (GA4)", source: "ga4" },
  { id: "aet", label: "AET (GA4)", source: "ga4" },
  { id: "convUsers", label: "Converting Active Users (GA4)", source: "event" },
  { id: "convSessions", label: "Converting Sessions (GA4)", source: "event" },
  { id: "eventPurchase", label: "Event Purchase (GA4)", source: "event" },
  { id: "leadPerUser", label: "Lead per User (ratio)", source: "calc" },
  { id: "userConvRate", label: "User Conversion Rate (%)", source: "calc" },
  { id: "avgRank", label: "AVG Rank", source: "gsc" },
];

/**
 * The Via Entry table carries the GA4 rows only — there is no GSC export by
 * landing page, so Clicks, Impressions and AVG Rank have no source.
 */
export const ENTRY_METRICS = METRICS.filter((m) => m.source !== "gsc");

/** Normalise an event entry across the old and current stored shapes. */
function eventValues(entry) {
  if (!entry) return null;
  return {
    users: entry.users ?? null,
    sessions: entry.sessions ?? null,
    // Pre-rename imports stored only the event total, under its old name.
    eventCount: entry.eventCount ?? entry.clickContactAgent ?? null,
  };
}

function trafficValues(entry) {
  if (!entry) return null;
  return {
    views: entry.views ?? null,
    users: entry.users ?? null,
    sessions: entry.sessions ?? null,
    aet_seconds: entry.aet_seconds ?? null,
  };
}

/**
 * GA4 traffic for one main-table segment: its own filtered export first, then
 * the per-segment split of an all-segments export as a fallback.
 */
function segmentTraffic(flow2Data, segId, mk) {
  if (segId === "all_organic") {
    return trafficValues(flow2Data[`ga4_free_${mk}`]?.all_organic);
  }
  const dedicated = flow2Data[`ga4_${segId}_${mk}`];
  if (dedicated) return trafficValues(dedicated);
  const mixed = flow2Data[`ga4_free_${mk}`];
  // `mixed[segId]` is where pre-split-map imports kept dijual/disewa/blog.
  return trafficValues(mixed?.segments?.[segId] ?? mixed?.[segId]);
}

function segmentEvent(flow2Data, segId, mk) {
  const mixed = flow2Data[`ga4_leads_${mk}`];
  if (segId === "all_organic") {
    return eventValues(mixed?.all_organic ?? mixed);
  }
  const dedicated = flow2Data[`ga4_leads_${segId}_${mk}`];
  if (dedicated) return eventValues(dedicated);
  return eventValues(mixed?.segments?.[segId]);
}

function entryTraffic(flow2Data, entrySeg, mk) {
  const dedicated = flow2Data[`ga4_entry_${entrySeg.base}_${mk}`];
  if (dedicated) return trafficValues(dedicated);
  return trafficValues(
    flow2Data[`ga4_entry_free_${mk}`]?.segments?.[entrySeg.id],
  );
}

function entryEvent(flow2Data, entrySeg, mk) {
  const dedicated = flow2Data[`ga4_entry_leads_${entrySeg.base}_${mk}`];
  if (dedicated) return eventValues(dedicated);
  return eventValues(
    flow2Data[`ga4_entry_leads_free_${mk}`]?.segments?.[entrySeg.id],
  );
}

function aggregateGSCRows(entry) {
  if (!entry || !Array.isArray(entry.rows)) return entry;
  // Prefer Chart sheet daily aggregates when available — same method as direct Chart upload.
  if (entry.chartAgg) return entry.chartAgg;
  // Fallback for older stored entries: impression-weighted average from URL rows.
  let clicks = 0,
    impressions = 0,
    posWeightedSum = 0,
    posImpressions = 0;
  for (const row of entry.rows) {
    clicks += row.clicks ?? 0;
    impressions += row.impressions ?? 0;
    const rank = row.rank ?? 0;
    const imp = row.impressions ?? 0;
    if (rank > 0 && imp > 0) {
      posWeightedSum += rank * imp;
      posImpressions += imp;
    }
  }
  return {
    clicks,
    impressions,
    avgPosition: posImpressions > 0 ? posWeightedSum / posImpressions : 0,
  };
}

function aggregateGA4Rows(entry) {
  if (!entry || !Array.isArray(entry.rows)) return null;
  // Use stored grand total when available — exact match with the direct-upload path
  // which reads the same grand total row from the GA4 export file.
  if (entry.grandTotal) return entry.grandTotal;
  // Fallback for old stored entries (no grandTotal): session-weighted average from
  // URL rows approximates the grand total AET better than unweighted, but is not exact.
  let views = 0,
    users = 0,
    sessions = 0,
    aetWeightedSum = 0;
  for (const row of entry.rows) {
    views += row.views ?? 0;
    users += row.users ?? 0;
    const s = row.sessions ?? 0;
    sessions += s;
    const a = row.aet_seconds ?? 0;
    if (a > 0 && s > 0) aetWeightedSum += a * s;
  }
  return {
    views,
    users,
    sessions,
    aet_seconds: sessions > 0 ? aetWeightedSum / sessions : 0,
  };
}

/**
 * Overlay Flow 1's imports onto Flow 2's own, under the keys Flow 2 reads.
 *
 * Flow 1 already holds GSC and GA4 for /dijual/, /disewa/ and the blog, so
 * those three blocks fill in without re-uploading the same export here. A file
 * uploaded directly to Flow 2 wins over the Flow 1 copy.
 */
const FLOW1_REUSE = [
  ["bc_gsc_dijual_", "gsc_dijual_", aggregateGSCRows],
  ["bc_gsc_disewa_", "gsc_disewa_", aggregateGSCRows],
  ["blog_gsc_", "gsc_blog_", aggregateGSCRows],
  ["bc_ga4_dijual_", "ga4_dijual_", aggregateGA4Rows],
  ["bc_ga4_disewa_", "ga4_disewa_", aggregateGA4Rows],
  ["blog_ga4_", "ga4_blog_", aggregateGA4Rows],
];

export function mergeFlow1Reuse(flow1Data, flow2Data) {
  const fromFlow1 = {};
  for (const [key, entry] of Object.entries(flow1Data)) {
    for (const [from, to, aggregate] of FLOW1_REUSE) {
      if (!key.startsWith(from)) continue;
      fromFlow1[to + key.slice(from.length)] = aggregate(entry);
      break;
    }
  }
  return { ...fromFlow1, ...flow2Data };
}

/** Assemble one block's twelve metrics from its three possible sources. */
function buildCell(gsc, traffic, event) {
  const users = traffic?.users ?? null;
  const eventPurchase = event?.eventCount ?? null;
  const convUsers = event?.users ?? null;

  return {
    clicks: gsc?.clicks ?? null,
    impressions: gsc?.impressions ?? null,
    views: traffic?.views ?? null,
    users,
    sessions: traffic?.sessions ?? null,
    aet: traffic?.aet_seconds ?? null,
    convUsers,
    convSessions: event?.sessions ?? null,
    eventPurchase,
    leadPerUser:
      users > 0 && eventPurchase !== null ? eventPurchase / users : null,
    userConvRate: users > 0 && convUsers !== null ? convUsers / users : null,
    avgRank: gsc?.avgPosition ?? null,
  };
}

/**
 * Compute both tables from stored flow2Data.
 *
 * Returns one map keyed by segment id — the ten main-table segments plus the
 * three `entry_*` ones — each holding `{ [monthKey]: { ...metrics } }`.
 * A metric with no export behind it is null rather than 0, so a half-imported
 * month renders (and exports) as blank instead of a misleading zero.
 */
export function computeFlow2Output(flow2Data, slots) {
  const result = {};

  for (const seg of SEGMENTS) {
    result[seg.id] = {};
    for (const slot of slots) {
      const mk = slot.key;
      result[seg.id][mk] = buildCell(
        flow2Data[`gsc_${seg.id}_${mk}`],
        segmentTraffic(flow2Data, seg.id, mk),
        segmentEvent(flow2Data, seg.id, mk),
      );
    }
  }

  for (const entrySeg of ENTRY_SEGMENTS) {
    result[entrySeg.id] = {};
    for (const slot of slots) {
      const mk = slot.key;
      result[entrySeg.id][mk] = buildCell(
        null,
        entryTraffic(flow2Data, entrySeg, mk),
        entryEvent(flow2Data, entrySeg, mk),
      );
    }
  }

  return result;
}

/**
 * Format a metric value for display. Returns "" for a metric with no data so
 * the sheet gets a blank cell rather than a zero that reads as measured.
 */
export function formatMetricValue(metricId, value) {
  if (value === null || value === undefined) return "";
  switch (metricId) {
    case "aet":
      return secondsToHmmss(value);
    case "avgRank":
      return value.toFixed(1);
    case "leadPerUser":
    case "userConvRate":
      return (value * 100).toFixed(2) + "%";
    default:
      return Math.round(value).toLocaleString();
  }
}

// ─── Sheet layout ─────────────────────────────────────────────────────────────
//
// Each segment occupies an 8-column block: a metric-label column, six month
// columns, and a spacer. Block 0 starts in column A, so the whole table is
// 8 × (segments − 1) + 7 columns wide. The Via Entry table repeats that
// geometry lower down, using only the blocks its three segments sit in, which
// is what keeps the two tables aligned under one row of month headers.

const BLOCK_STRIDE = 8;
const MONTHS_PER_BLOCK = 6;

const BANNER =
  "⚠️ Do not change anything.\n" +
  "The data is generated automatically from another file. " +
  "Any edits here may corrupt the data";

const ROW_BANNER = 0;
const ROW_SEGMENT_HEADERS = 1;
const ROW_MONTH_HEADERS = 2;
const ROW_FIRST_METRIC = 3;
const ROW_ENTRY_HEADERS = ROW_FIRST_METRIC + METRICS.length + 1; // one blank row between
const ROW_FIRST_ENTRY_METRIC = ROW_ENTRY_HEADERS + 1;
const TOTAL_ROWS = ROW_FIRST_ENTRY_METRIC + ENTRY_METRICS.length;

const labelCol = (block) => block * BLOCK_STRIDE;
const monthCol = (block, i) => block * BLOCK_STRIDE + 1 + i;
const TOTAL_COLS = monthCol(SEGMENTS.length - 1, MONTHS_PER_BLOCK - 1) + 1;

/** "Apr 2026" → "Apr" — the sheet labels months without the year. */
function shortMonthLabel(slot) {
  return String(slot.label ?? "").split(" ")[0];
}

/**
 * Annotate the month headers of partly-covered months, e.g. "Sep (1-18)" for
 * a window whose newest month was exported mid-month. The day range comes
 * from the exports themselves, so the header follows the data instead of
 * being typed into the sheet and wiped by the next push.
 *
 * The widest range any of that month's exports covers wins: a month is only
 * partial if nothing imported for it reaches the last day.
 */
export function withSheetLabels(flow2Data, slots) {
  return slots.map((slot) => {
    let start = null;
    let end = null;
    for (const key of Object.keys(flow2Data)) {
      if (!key.endsWith(`_${slot.key}`)) continue;
      const days = flow2Data[key]?.days;
      if (!days) continue;
      start = start === null ? days.start : Math.min(start, days.start);
      end = end === null ? days.end : Math.max(end, days.end);
    }
    const daysInMonth = new Date(slot.year, slot.month, 0).getDate();
    if (start === null || (start <= 1 && end >= daysInMonth)) return slot;
    return {
      ...slot,
      sheetLabel: `${shortMonthLabel(slot)} (${start}-${end})`,
    };
  });
}

function segmentHeaderText(seg) {
  return seg.sublabel ? `${seg.label}\n${seg.sublabel}` : seg.label;
}

/**
 * Build the Traffic Overview sheet as a 2D array, matching the report's block
 * layout cell for cell. Used for both the CSV download and the Sheets push.
 */
export function buildFlow2CSV(outputData, slots) {
  const grid = Array.from({ length: TOTAL_ROWS }, () =>
    Array.from({ length: TOTAL_COLS }, () => ""),
  );

  grid[ROW_BANNER][0] = BANNER;

  SEGMENTS.forEach((seg, block) => {
    // Block 0's heading sits above its first month column, not above the
    // metric labels — the report has always been laid out that way.
    grid[ROW_SEGMENT_HEADERS][block === 0 ? 1 : labelCol(block)] =
      segmentHeaderText(seg);

    slots.forEach((slot, i) => {
      grid[ROW_MONTH_HEADERS][monthCol(block, i)] =
        slot.sheetLabel ?? shortMonthLabel(slot);
    });

    METRICS.forEach((metric, r) => {
      const row = ROW_FIRST_METRIC + r;
      grid[row][labelCol(block)] = metric.label;
      slots.forEach((slot, i) => {
        const val = outputData[seg.id]?.[slot.key]?.[metric.id];
        grid[row][monthCol(block, i)] = formatMetricValue(metric.id, val);
      });
    });
  });

  for (const entrySeg of ENTRY_SEGMENTS) {
    const block = entrySeg.blockIndex;
    grid[ROW_ENTRY_HEADERS][labelCol(block)] = entrySeg.label;

    ENTRY_METRICS.forEach((metric, r) => {
      const row = ROW_FIRST_ENTRY_METRIC + r;
      grid[row][labelCol(block)] = metric.label;
      slots.forEach((slot, i) => {
        const val = outputData[entrySeg.id]?.[slot.key]?.[metric.id];
        grid[row][monthCol(block, i)] = formatMetricValue(metric.id, val);
      });
    });
  }

  return grid;
}
