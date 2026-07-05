import { secondsToHmmss, formatCTR } from "./dateUtils";

// ─── Lookup map builders ──────────────────────────────────────────────────────

function buildGSCMap(rows) {
  const map = {};
  for (const r of rows) {
    if (!r.slug) continue;
    if (map[r.slug]) {
      // Merge duplicate slugs: SUM clicks/impressions, AVG ctr/rank
      map[r.slug].clicks += r.clicks;
      map[r.slug].impressions += r.impressions;
      map[r.slug].ctr = (map[r.slug].ctr + r.ctr) / 2;
      map[r.slug].rank = (map[r.slug].rank + r.rank) / 2;
    } else {
      map[r.slug] = { ...r };
    }
  }
  return map;
}

function buildGA4Map(rows) {
  const map = {};
  for (const r of rows) {
    if (r.slug) map[r.slug] = { ...r };
  }
  return map;
}

/**
 * Merge BC dijual + disewa GSC rows into one map.
 * Paths are disjoint (/dijual/… vs /disewa/…) so this is a union;
 * buildGSCMap handles any rare overlapping slugs with SUM/AVG.
 */
function mergeBCGSC(dijualRows, disewaRows) {
  return buildGSCMap([...(dijualRows || []), ...(disewaRows || [])]);
}

const Z_GSC = { rank: 0, impressions: 0, clicks: 0, ctr: 0 };
const Z_GA4 = { views: 0, users: 0, sessions: 0, aet_seconds: 0 };

// ─── Output computation ───────────────────────────────────────────────────────

/**
 * Compute per-URL output rows for one project across all slots.
 * Returns array of { urlRow, metrics: { rank, impressions, clicks, ctr, views, users, sessions, aet } }
 * where each metric value is an array of length slots.length.
 */
export function computeFlow1Output(project, urlList, flow1Data, slots) {
  const gscMaps = {};
  const ga4Maps = {};

  for (const slot of slots) {
    if (project === "bc") {
      const dijual = flow1Data[`bc_gsc_dijual_${slot.key}`]?.rows;
      const disewa = flow1Data[`bc_gsc_disewa_${slot.key}`]?.rows;
      if (dijual || disewa) gscMaps[slot.key] = mergeBCGSC(dijual, disewa);
      const ga4 = flow1Data[`bc_ga4_${slot.key}`]?.rows;
      if (ga4) ga4Maps[slot.key] = buildGA4Map(ga4);
    } else {
      const gsc = flow1Data[`blog_gsc_${slot.key}`]?.rows;
      if (gsc) gscMaps[slot.key] = buildGSCMap(gsc);
      const ga4 = flow1Data[`blog_ga4_${slot.key}`]?.rows;
      if (ga4) ga4Maps[slot.key] = buildGA4Map(ga4);
    }
  }

  return urlList.map((urlRow) => {
    const slug = urlRow.slug || "";
    const metrics = {
      rank: [],
      impressions: [],
      clicks: [],
      ctr: [],
      views: [],
      users: [],
      sessions: [],
      aet: [],
    };

    for (const slot of slots) {
      const gsc = (gscMaps[slot.key] || {})[slug] || Z_GSC;
      const ga4 = (ga4Maps[slot.key] || {})[slug] || Z_GA4;
      metrics.rank.push(gsc.rank);
      metrics.impressions.push(gsc.impressions);
      metrics.clicks.push(gsc.clicks);
      metrics.ctr.push(gsc.ctr);
      metrics.views.push(ga4.views);
      metrics.users.push(ga4.users);
      metrics.sessions.push(ga4.sessions);
      metrics.aet.push(ga4.aet_seconds);
    }

    return { urlRow, metrics };
  });
}

// ─── CSV / export builders ────────────────────────────────────────────────────

const METRIC_GROUPS = [
  { name: "Rank", key: "rank", fmt: (v) => (v ? v.toFixed(2) : "0") },
  {
    name: "Impressions",
    key: "impressions",
    fmt: (v) => String(Math.round(v)),
  },
  { name: "Clicks", key: "clicks", fmt: (v) => String(Math.round(v)) },
  { name: "CTR", key: "ctr", fmt: (v) => (v ? formatCTR(v) : "0%") },
  { name: "Views", key: "views", fmt: (v) => String(Math.round(v)) },
  { name: "Active Users", key: "users", fmt: (v) => String(Math.round(v)) },
  { name: "Sessions", key: "sessions", fmt: (v) => String(Math.round(v)) },
  { name: "AET", key: "aet", fmt: (v) => (v ? secondsToHmmss(v) : "0:00:00") },
];

const BC_URL_FIELDS = [
  { header: "Main Keyword", key: "main_keyword" },
  { header: "Offer", key: "offer" },
  { header: "Property", key: "property" },
  { header: "URL", key: "url" },
  { header: "Publish", key: "publish" },
  { header: "Status", key: "status" },
  { header: "PIC", key: "pic" },
  { header: "Slug", key: "slug" },
];

const BLOG_URL_FIELDS = [
  { header: "Keyword", key: "keyword" },
  { header: "URL", key: "url" },
  { header: "Status", key: "status" },
  { header: "Publish Date", key: "publish_date" },
  { header: "Content Type", key: "content_type" },
  { header: "PIC", key: "pic" },
  { header: "Slug", key: "slug" },
];

export function buildCSVData(project, outputRows, slots) {
  const urlFields = project === "bc" ? BC_URL_FIELDS : BLOG_URL_FIELDS;

  const headers = [
    ...urlFields.map((f) => f.header),
    ...METRIC_GROUPS.flatMap((g) => slots.map((s) => `${g.name} ${s.label}`)),
  ];

  const rows = outputRows.map(({ urlRow, metrics }) => [
    ...urlFields.map((f) => urlRow[f.key] ?? ""),
    ...METRIC_GROUPS.flatMap((g) => metrics[g.key].map((v) => g.fmt(v))),
  ]);

  return [headers, ...rows];
}

/**
 * Values-only array for Sheets API push.
 * Order matches Apps Script column layout:
 * Rank×n, Impressions×n, Clicks×n, CTR×n, Views×n, Users×n, Sessions×n, AET×n
 */
export function buildSheetsValues(outputRows) {
  return outputRows.map(({ metrics }) => [
    ...metrics.rank.map((v) => (v ? Number(v.toFixed(2)) : 0)),
    ...metrics.impressions.map((v) => Math.round(v)),
    ...metrics.clicks.map((v) => Math.round(v)),
    ...metrics.ctr.map((v) => (v ? formatCTR(v) : "0%")),
    ...metrics.views.map((v) => Math.round(v)),
    ...metrics.users.map((v) => Math.round(v)),
    ...metrics.sessions.map((v) => Math.round(v)),
    ...metrics.aet.map((v) => (v ? secondsToHmmss(v) : "0:00:00")),
  ]);
}
