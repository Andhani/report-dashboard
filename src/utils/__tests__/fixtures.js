// Shared fixture for the report-computation tests.
//
// Deliberately covers the cases the flows branch on, so a regression shows up
// as a changed number rather than a passing test on trivial data:
//   - every status the leads filter accepts, plus one it must reject (Draft)
//   - both Blog content types, plus a row whose Content Type cell does not
//     exactly match either ("update" in lower case) — import copies sheet
//     text verbatim, so only an exact match is counted
//   - rows inside and outside the selected month, and inside and outside a
//     partial day range
//   - BC data split across the two segment keys (dijual + disewa)

export const slots = [
  { key: "2026-08", label: "Aug 2026", year: 2026, month: 8 },
  { key: "2026-09", label: "Sep 2026", year: 2026, month: 9 },
];

export const blogUrls = [
  { id: "row-000000", keyword: "harga rumah jakarta", url: "https://www.brighton.co.id/blog/harga-rumah", status: "Published", content_type: "Create", publish_date: "2026-09-03", pic: "Ali", slug: "/blog/harga-rumah" },
  { id: "row-000001", keyword: "tips kpr", url: "https://www.brighton.co.id/blog/tips-kpr", status: "Published Create", content_type: "Create", publish_date: "2026-09-11", pic: "Budi", slug: "/blog/tips-kpr" },
  { id: "row-000002", keyword: "investasi properti", url: "https://www.brighton.co.id/blog/investasi", status: "Published Upgrade", content_type: "Update", publish_date: "2026-09-20", pic: "Citra", slug: "/blog/investasi" },
  { id: "row-000003", keyword: "sewa apartemen", url: "https://www.brighton.co.id/blog/sewa-apt", status: "Draft", content_type: "Create", publish_date: "2026-09-05", pic: "Dedi", slug: "/blog/sewa-apt" },
  { id: "row-000004", keyword: "rumah bekas", url: "https://www.brighton.co.id/blog/rumah-bekas", status: "Published", content_type: "update", publish_date: "2026-09-08", pic: "Eka", slug: "/blog/rumah-bekas" },
  { id: "row-000005", keyword: "bulan lalu", url: "https://www.brighton.co.id/blog/lama", status: "Published", content_type: "Create", publish_date: "2026-08-15", pic: "Fajar", slug: "/blog/lama" },
];

export const bcUrls = [
  { id: "row-000000", main_keyword: "rumah dijual bsd", offer: "dijual/", property: "Rumah", url: "https://www.brighton.co.id/dijual/rumah-bsd", publish: "2026-09-02", status: "Published", pic: "Ali", slug: "/dijual/rumah-bsd" },
  { id: "row-000001", main_keyword: "apartemen disewa", offer: "disewa/", property: "Apartemen", url: "https://www.brighton.co.id/disewa/apt-scbd", publish: "2026-09-18", status: "Published Create", pic: "Budi", slug: "/disewa/apt-scbd" },
  { id: "row-000002", main_keyword: "ruko dijual", offer: "dijual/", property: "Ruko", url: "https://www.brighton.co.id/dijual/ruko-kelapa", publish: "2026-09-25", status: "Draft", pic: "Citra", slug: "/dijual/ruko-kelapa" },
];

// Field names match what parseFlow1 emits — `rank`, not `position`.
const gsc = (slug, clicks, impressions, rank) => ({ slug, clicks, impressions, rank, ctr: clicks / impressions });
const ga4 = (slug, views, users, sessions, aet_seconds) => ({ slug, views, users, sessions, aet_seconds });

export const flow1Data = {
  "blog_gsc_2026-09": { rows: [gsc("/blog/harga-rumah", 120, 3400, 4.2), gsc("/blog/tips-kpr", 80, 2100, 6.7), gsc("/blog/investasi", 45, 1200, 9.1), gsc("/blog/rumah-bekas", 30, 900, 12.5)] },
  "blog_ga4_2026-09": { rows: [ga4("/blog/harga-rumah", 900, 700, 820, 95.4), ga4("/blog/tips-kpr", 640, 500, 590, 130.2), ga4("/blog/investasi", 310, 250, 290, 70.8), ga4("/blog/rumah-bekas", 150, 120, 140, 45.0)] },
  "blog_gsc_2026-08": { rows: [gsc("/blog/lama", 200, 5000, 3.1)] },
  "blog_ga4_2026-08": { rows: [ga4("/blog/lama", 1500, 1200, 1400, 110.0)] },
  "bc_gsc_dijual_2026-09": { rows: [gsc("/dijual/rumah-bsd", 60, 1800, 5.5)] },
  "bc_gsc_disewa_2026-09": { rows: [gsc("/disewa/apt-scbd", 25, 700, 8.8)] },
  "bc_ga4_dijual_2026-09": { rows: [ga4("/dijual/rumah-bsd", 400, 320, 380, 88.0)] },
  "bc_ga4_disewa_2026-09": { rows: [ga4("/disewa/apt-scbd", 180, 140, 170, 62.5)] },
};

export const flow2Data = {
  "ga4_free_2026-09": { all_organic: { views: 50000, users: 38000, sessions: 44000 } },
  "ga4_leads_2026-09": { clickContactAgent: 1250 },
  "ga4_free_2026-08": { all_organic: { views: 47000, users: 36000, sessions: 41000 } },
  "ga4_leads_2026-08": { clickContactAgent: 1100 },
};
