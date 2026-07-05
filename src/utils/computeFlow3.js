import { secondsToHmmss, getIndonesianMonth } from "./dateUtils";

/**
 * Get the most recent month slot (last slot in the 6-month Flow 1 window).
 */
export function getLeadsMonth(slots) {
  return slots[slots.length - 1] ?? null;
}

/**
 * Filter URL list rows to those published in the given month.
 * dateField: 'publish' (BC) or 'publish_date' (Blog)
 */
function filterByMonth(urlList, dateField, year, month) {
  return urlList.filter((row) => {
    const d = row[dateField];
    if (!d) return false;
    // Accept YYYY-MM-DD or YYYY-MM
    const m = String(d).match(/^(\d{4})-(\d{2})/);
    if (!m) return false;
    return parseInt(m[1]) === year && parseInt(m[2]) === month;
  });
}

/**
 * Get GA4 per-URL metrics for a list of URLs from Flow 1 data.
 * Returns map: slug → { views, users, sessions, aet_seconds }
 */
function getGA4MetricsMap(flow1Data, monthKey, project) {
  const entry = flow1Data[`${project}_ga4_${monthKey}`];
  if (!entry?.rows) return {};
  const map = {};
  for (const r of entry.rows) {
    if (r.slug) map[r.slug] = r;
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
 * Compute BC Leads Summary block for a given month.
 */
export function computeBCLeads(bcUrls, flow1Data, flow2Data, slot) {
  const { key: monthKey, year, month } = slot;
  const published = filterByMonth(bcUrls, "publish", year, month);
  const ga4Map = getGA4MetricsMap(flow1Data, monthKey, "bc");

  const slugs = published.map((u) => u.slug).filter(Boolean);
  const traffic = sumGA4(slugs, ga4Map);

  // Lead rates from Flow 2
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
 * Compute Blog Leads Summary block for a given month.
 * Splits into Create vs Update sub-blocks.
 */
export function computeBlogLeads(blogUrls, flow1Data, flow2Data, slot) {
  const { key: monthKey, year, month } = slot;
  const published = filterByMonth(blogUrls, "publish_date", year, month);
  const ga4Map = getGA4MetricsMap(flow1Data, monthKey, "blog");

  const creates = published.filter((u) => u.content_type === "Create");
  const updates = published.filter(
    (u) => u.content_type === "Update" || u.content_type === "Optimize",
  );

  const createTraffic = sumGA4(
    creates.map((u) => u.slug),
    ga4Map,
  );
  const updateTraffic = sumGA4(
    updates.map((u) => u.slug),
    ga4Map,
  );

  // Lead rates from Flow 2
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
      count: published.length,
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
