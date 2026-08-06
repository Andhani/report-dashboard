import { secondsToHmmss, getIndonesianMonth } from "./dateUtils";

/**
 * Get the most recent month slot (last slot in the 6-month Flow 1 window).
 */
export function getLeadsMonth(slots) {
  return slots[slots.length - 1] ?? null;
}

// Month name tables for robust date parsing (Indonesian + English)
const MONTH_ID = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
};
const MONTH_EN = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
  sep: 9, oct: 10, nov: 11, dec: 12,
};

// Statuses treated as "published" for BC and Blog Create counts
const PUBLISHED_STATUSES = new Set([
  "Published",
  "Published Create",
  "Published Upgrade",
]);

/**
 * Parse a date string into { year, month, day }.
 * Handles: YYYY-MM-DD, YYYY-MM, DD/MM/YYYY, D MonthName YYYY, MonthName YYYY.
 * When day is not present in the format, day defaults to 1.
 */
function parseDateToYMD(d) {
  if (!d) return null;
  const s = String(d).trim();
  // YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { year: +m[1], month: +m[2], day: +m[3] };
  // YYYY-MM (no day)
  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return { year: +m[1], month: +m[2], day: 1 };
  // DD/MM/YYYY or D/M/YYYY (Indonesian locale — day comes first)
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return { year: +m[3], month: +m[2], day: +m[1] };
  // D MonthName YYYY e.g. "1 Juni 2026"
  m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const mo = MONTH_ID[m[2].toLowerCase()] ?? MONTH_EN[m[2].toLowerCase()];
    if (mo) return { year: +m[3], month: mo, day: +m[1] };
  }
  // MonthName YYYY e.g. "Juni 2026" (no day)
  m = s.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const mo = MONTH_ID[m[1].toLowerCase()] ?? MONTH_EN[m[1].toLowerCase()];
    if (mo) return { year: +m[2], month: mo, day: 1 };
  }
  // Native Date parsing as last resort
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) return { year: dt.getFullYear(), month: dt.getMonth() + 1, day: dt.getDate() };
  return null;
}

/**
 * Filter URL list rows to those whose date falls within the given month and
 * optional day range. startDay / endDay are 1-based day numbers (inclusive);
 * pass null to leave that end open (defaults to full month).
 *
 * dateField: 'publish' (BC) or 'publish_date' (Blog)
 */
function filterByDateRange(urlList, dateField, year, month, startDay, endDay) {
  return urlList.filter((row) => {
    const ymd = parseDateToYMD(row[dateField]);
    if (!ymd || ymd.year !== year || ymd.month !== month) return false;
    if (startDay !== null && ymd.day < startDay) return false;
    if (endDay !== null && ymd.day > endDay) return false;
    return true;
  });
}

/**
 * Get GA4 per-URL metrics for a list of URLs from Flow 1 data.
 * Returns map: slug → { views, users, sessions, aet_seconds }
 *
 * BC data is stored in two separate segment keys (dijual + disewa);
 * Blog is stored under a single key.
 */
function getGA4MetricsMap(flow1Data, monthKey, project) {
  const keys =
    project === "bc"
      ? [`bc_ga4_dijual_${monthKey}`, `bc_ga4_disewa_${monthKey}`]
      : [`${project}_ga4_${monthKey}`];

  const map = {};
  for (const key of keys) {
    const entry = flow1Data[key];
    if (!entry?.rows) continue;
    for (const r of entry.rows) {
      if (r.slug) map[r.slug] = r;
    }
  }
  return map;
}

const Z_GA4 = { views: 0, users: 0, sessions: 0, aet_seconds: 0 };

function sumGA4(slugs, ga4Map) {
  let views = 0,
    users = 0,
    sessions = 0,
    aetSum = 0,
    aetCount = 0;
  for (const slug of slugs) {
    const d = ga4Map[slug] || Z_GA4;
    views += d.views;
    users += d.users;
    sessions += d.sessions;
    // Plain mean of per-URL AET, excluding 0:00:00 rows — matches the
    // spreadsheet's AVERAGE() over the non-zero AET column.
    if (d.aet_seconds > 0) {
      aetSum += d.aet_seconds;
      aetCount++;
    }
  }
  return {
    views,
    users,
    sessions,
    aet_seconds: aetCount > 0 ? aetSum / aetCount : 0,
  };
}

/**
 * Compute BC Leads Summary block for a given month and optional date range.
 *
 * Only rows with a published-related status (Published, Published Create,
 * Published Upgrade) and a publish date within the selected range are counted.
 * GA4 metrics are pulled for those exact slugs.
 *
 * dateRange: { startDay: number|null, endDay: number|null } — null means open
 */
export function computeBCLeads(bcUrls, flow1Data, flow2Data, slot, dateRange) {
  const { key: monthKey, year, month } = slot;
  const startDay = dateRange?.startDay ?? null;
  const endDay = dateRange?.endDay ?? null;

  // Step 1: filter by date range, then by published-related status
  const published = filterByDateRange(
    bcUrls,
    "publish",
    year,
    month,
    startDay,
    endDay,
  ).filter((u) => PUBLISHED_STATUSES.has(u.status));

  const ga4Map = getGA4MetricsMap(flow1Data, monthKey, "bc");

  // Steps 4 & 5: GA4 metrics summed only for the filtered slug set
  const slugs = published.map((u) => u.slug).filter(Boolean);
  const traffic = sumGA4(slugs, ga4Map);

  // Lead rates from Flow 2 (site-wide totals — unchanged)
  const ga4Free = flow2Data[`ga4_free_${monthKey}`];
  const ga4Leads = flow2Data[`ga4_leads_${monthKey}`];

  const totalViews = ga4Free?.all_organic?.views ?? 0;
  const totalUsers = ga4Free?.all_organic?.users ?? 0;
  const totalSessions = ga4Free?.all_organic?.sessions ?? 0;
  const clickContact = ga4Leads?.clickContactAgent ?? 0;

  const rates = {
    leadPerViews: totalViews > 0 ? clickContact / totalViews : 0,
    leadPerUsers: totalUsers > 0 ? clickContact / totalUsers : 0,
    leadPerSessions: totalSessions > 0 ? clickContact / totalSessions : 0,
  };

  return {
    monthLabel: `${getIndonesianMonth(month)} ${year}`,
    count: published.length,
    traffic,
    rates,
    siteWide: { totalViews, totalUsers, totalSessions, clickContact },
    estimated: {
      views: traffic.views * rates.leadPerViews,
      users: traffic.users * rates.leadPerUsers,
      sessions: traffic.sessions * rates.leadPerSessions,
    },
  };
}

/**
 * Compute Blog Leads Summary block for a given month and optional date range.
 *
 * - Creates: rows with published-related status (Published / Published Create /
 *   Published Upgrade) within the date range.
 * - Updates: rows with "Update" status within the date range.
 * - GA4 metrics (steps 4 & 5) use the exact slug sets from steps 1–3.
 *
 * dateRange: { startDay: number|null, endDay: number|null }
 */
export function computeBlogLeads(blogUrls, flow1Data, flow2Data, slot, dateRange) {
  const { key: monthKey, year, month } = slot;
  const startDay = dateRange?.startDay ?? null;
  const endDay = dateRange?.endDay ?? null;

  const ga4Map = getGA4MetricsMap(flow1Data, monthKey, "blog");

  // Step 1: all in-range, published-related rows
  const inRange = filterByDateRange(
    blogUrls,
    "publish_date",
    year,
    month,
    startDay,
    endDay,
  ).filter((u) => PUBLISHED_STATUSES.has(u.status));

  // Step 2: Creates — "Create" content type only
  const creates = inRange.filter((u) => u.content_type === "Create");

  // Step 3: Updates — "Update" content type only
  const updates = inRange.filter((u) => u.content_type === "Update");

  // Steps 4 & 5: GA4 metrics for each group's exact slug set
  const createTraffic = sumGA4(
    creates.map((u) => u.slug),
    ga4Map,
  );
  const updateTraffic = sumGA4(
    updates.map((u) => u.slug),
    ga4Map,
  );

  // Lead rates from Flow 2 (site-wide totals — unchanged)
  const ga4Free = flow2Data[`ga4_free_${monthKey}`];
  const ga4Leads = flow2Data[`ga4_leads_${monthKey}`];

  const totalViews = ga4Free?.all_organic?.views ?? 0;
  const totalUsers = ga4Free?.all_organic?.users ?? 0;
  const totalSessions = ga4Free?.all_organic?.sessions ?? 0;
  const clickContact = ga4Leads?.clickContactAgent ?? 0;

  const rates = {
    leadPerViews: totalViews > 0 ? clickContact / totalViews : 0,
    leadPerUsers: totalUsers > 0 ? clickContact / totalUsers : 0,
    leadPerSessions: totalSessions > 0 ? clickContact / totalSessions : 0,
  };

  function estimated(t) {
    return {
      views: t.views * rates.leadPerViews,
      users: t.users * rates.leadPerUsers,
      sessions: t.sessions * rates.leadPerSessions,
    };
  }

  return {
    monthLabel: `${getIndonesianMonth(month)} ${year}`,
    creates: {
      count: creates.length,
      traffic: createTraffic,
      estimated: estimated(createTraffic),
    },
    updates: {
      count: updates.length,
      traffic: updateTraffic,
      estimated: estimated(updateTraffic),
    },
    grandTotal: {
      count: creates.length + updates.length,
      traffic: sumGA4(
        [...creates, ...updates].map((u) => u.slug),
        ga4Map,
      ),
    },
    rates,
    siteWide: { totalViews, totalUsers, totalSessions, clickContact },
  };
}

// ─── Format helpers ───────────────────────────────────────────────────────────

export function fmtNum(n) {
  if (!n) return "0";
  return Math.round(n).toLocaleString();
}

export function fmtAET(s) {
  return s ? secondsToHmmss(s) : "0:00:00";
}

export function fmtRate(r) {
  if (!r) return "0.00%";
  return (r * 100).toFixed(2) + "%";
}

export function fmtEst(n) {
  if (!n) return "0";
  return n.toFixed(1);
}

/**
 * Build CSV rows for a BC Leads block.
 */
export function buildBCLeadsCSV(block) {
  if (!block) return [];
  const { monthLabel, count, traffic, rates, siteWide, estimated } = block;
  return [
    [monthLabel],
    ["Data Source", "GA4"],
    [""],
    ["", "Traffic Summary", "", "Estimated Leads", "", "Lead per Views"],
    ["Bottom Content", "Metric", "Value", "Metric", "Value", "Metric", "Value"],
    [
      count,
      "Sum of Views",
      fmtNum(traffic.views),
      "Views-based",
      fmtEst(estimated.views),
      "Total Org Views",
      fmtNum(siteWide.totalViews),
    ],
    [
      "",
      "Sum of Active Users",
      fmtNum(traffic.users),
      "Users-based",
      fmtEst(estimated.users),
      "Click_Contact",
      fmtNum(siteWide.clickContact),
    ],
    [
      "",
      "Sum of Sessions",
      fmtNum(traffic.sessions),
      "Sessions-based",
      fmtEst(estimated.sessions),
      "Rate",
      fmtRate(rates.leadPerViews),
    ],
    ["", "Avg of AET", fmtAET(traffic.aet_seconds), "", "", ""],
    [""],
    ["", "", "", "", "", "Lead per Users"],
    ["", "", "", "", "", "Total Org Users", fmtNum(siteWide.totalUsers)],
    ["", "", "", "", "", "Click_Contact", fmtNum(siteWide.clickContact)],
    ["", "", "", "", "", "Rate", fmtRate(rates.leadPerUsers)],
    [""],
    ["", "", "", "", "", "Lead per Sessions"],
    ["", "", "", "", "", "Total Org Sessions", fmtNum(siteWide.totalSessions)],
    ["", "", "", "", "", "Click_Contact", fmtNum(siteWide.clickContact)],
    ["", "", "", "", "", "Rate", fmtRate(rates.leadPerSessions)],
    [""],
  ];
}

/**
 * Build CSV rows for a Blog Leads block.
 */
export function buildBlogLeadsCSV(block) {
  if (!block) return [];
  const { monthLabel, creates, updates, grandTotal, rates, siteWide } = block;
  return [
    [monthLabel],
    ["Data Source", "GA4"],
    [""],
    [
      "",
      "CREATE CONTENT",
      "",
      "Estimated Leads (Create)",
      "",
      "Lead per Views",
    ],
    [
      "Content Type",
      "Jumlah",
      "Metric",
      "Value",
      "Metric",
      "Value",
      "Metric",
      "Value",
    ],
    [
      "Create",
      creates.count,
      "Sum Views",
      fmtNum(creates.traffic.views),
      "Views-based",
      fmtEst(creates.estimated.views),
      "Total Org Views",
      fmtNum(siteWide.totalViews),
    ],
    [
      "Update",
      updates.count,
      "Sum Users",
      fmtNum(creates.traffic.users),
      "Users-based",
      fmtEst(creates.estimated.users),
      "Click_Contact",
      fmtNum(siteWide.clickContact),
    ],
    [
      "Grand Total",
      grandTotal.count,
      "Sum Sessions",
      fmtNum(creates.traffic.sessions),
      "Sessions-based",
      fmtEst(creates.estimated.sessions),
      "Rate",
      fmtRate(rates.leadPerViews),
    ],
    ["", "", "Avg AET", fmtAET(creates.traffic.aet_seconds)],
    [""],
    [
      "",
      "UPDATE CONTENT",
      "",
      "Estimated Leads (Update)",
      "",
      "Lead per Users",
    ],
    [
      "",
      updates.count,
      "Sum Views",
      fmtNum(updates.traffic.views),
      "Views-based",
      fmtEst(updates.estimated.views),
      "Total Org Users",
      fmtNum(siteWide.totalUsers),
    ],
    [
      "",
      "",
      "Sum Users",
      fmtNum(updates.traffic.users),
      "Users-based",
      fmtEst(updates.estimated.users),
      "Click_Contact",
      fmtNum(siteWide.clickContact),
    ],
    [
      "",
      "",
      "Sum Sessions",
      fmtNum(updates.traffic.sessions),
      "Sessions-based",
      fmtEst(updates.estimated.sessions),
      "Rate",
      fmtRate(rates.leadPerUsers),
    ],
    [
      "",
      "",
      "Avg AET",
      fmtAET(updates.traffic.aet_seconds),
      "",
      "",
      "Lead per Sessions",
    ],
    [
      "",
      "",
      "",
      "",
      "",
      "",
      "Total Org Sessions",
      fmtNum(siteWide.totalSessions),
    ],
    ["", "", "", "", "", "", "Click_Contact", fmtNum(siteWide.clickContact)],
    ["", "", "", "", "", "", "Rate", fmtRate(rates.leadPerSessions)],
    [""],
  ];
}
