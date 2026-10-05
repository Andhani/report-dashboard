/**
 * Segment definitions for the Traffic Overview (BC & Blog) sheet.
 *
 * The sheet lays each segment out as its own 8-column block, so this list is
 * the single source of truth for display order, labels, and — just as
 * importantly — the URL rule that decides which segment an export belongs to.
 */

// First URL segment of every non-agent-profile area of the site. An agent
// profile URL is a single slug naming a person (`/adelince`), so "one slug
// that isn't one of these" is what identifies it. Mirrors the exclusion
// filter applied on the GA4 side when the export is taken.
const RESERVED_FIRST_SEGMENTS = new Set([
  "dijual",
  "disewa",
  "bisnisproperti",
  "visitor",
  "dijualsewa",
  "perumahan-baru",
  "hitung-angsuran-kpr-bank",
  "titip-jual-properti",
  "peduli",
  "testimoni",
  "about",
  "why-brighton",
  "join-bisnis",
  "join-us",
  "agent",
  "login",
  "search",
  "sitemap",
  "store",
  "home",
  "syarat-dan-ketentuan",
  "syarat-dan-ketentuan-agent",
  "kebijakan-privasi",
  "pengecualian-tanggung-jawab",
  "pemberitahuan-hak-cipta",
  // Not in the GA4 filter (these paths have more than one slug so the filter
  // never needed them), but a bare single-slug hit would otherwise read as a
  // person's name.
  "articles-all",
  "cari-properti",
]);

/** Path with any query string and trailing slash removed, lowercased. */
function normalizePath(path) {
  const s = String(path ?? "").trim();
  if (!s.startsWith("/")) return null;
  const noQuery = s.split("?")[0].split("#")[0];
  const trimmed = noQuery.length > 1 ? noQuery.replace(/\/+$/, "") : noQuery;
  return trimmed.toLowerCase();
}

/** True for `/some-person-name` — exactly one slug, and not a known area. */
function isAgentProfilePath(path) {
  const p = normalizePath(path);
  if (!p || p === "/") return false;
  if (p.indexOf("/", 1) !== -1) return false;
  const slug = p.slice(1);
  if (!slug) return false;
  if (RESERVED_FIRST_SEGMENTS.has(slug)) return false;
  if (slug.startsWith("cari-properti")) return false;
  return true;
}

/** Matcher for "URL starts with /x" (with or without a deeper path). */
function startsWithSegment(name) {
  const re = new RegExp(`^/${name}(/|$)`);
  return (path) => {
    const p = normalizePath(path);
    return p !== null && re.test(p);
  };
}

/** Matcher for "URL contains /x/". */
function containsSegment(fragment) {
  return (path) => {
    const p = normalizePath(path);
    return p !== null && (p + "/").includes(fragment);
  };
}

/** Matcher for "URL starts with /x, but not under /x/<child>/". */
function startsWithSegmentExcept(name, child) {
  const inArea = startsWithSegment(name);
  const inChild = containsSegment(`/${name}/${child}/`);
  return (path) => inArea(path) && !inChild(path);
}

/**
 * The ten blocks of the main table, in sheet order.
 *
 * `match` decides which rows of a mixed export belong to this segment. The
 * rules are disjoint: a detail page belongs to its own block, not to the
 * listing block above it. `/perumahan-baru/viewdetail/x` therefore counts
 * towards "Detail Page Primary" only, which is how the GSC exports for these
 * two blocks are filtered (the Perumahan Baru filter excludes viewdetail
 * outright) and so how the sheet reports them.
 */
export const SEGMENTS = [
  {
    id: "all_organic",
    label: "All Organic Traffic",
    sublabel: null,
    short: "All Organic",
    match: null, // the grand total, not a URL rule
  },
  {
    id: "dijual",
    label: "Segment /dijual/ Traffic",
    sublabel: "Listing Secondary",
    short: "/dijual/",
    match: startsWithSegment("dijual"),
  },
  {
    id: "disewa",
    label: "Segment /disewa/ Traffic",
    sublabel: "Listing Secondary",
    short: "/disewa/",
    match: startsWithSegment("disewa"),
  },
  {
    id: "cari_properti_view",
    label: "All /cari-properti/view/ Traffic",
    sublabel: "Detail Page Secondary",
    short: "/cari-properti/view/",
    match: containsSegment("/cari-properti/view/"),
  },
  {
    id: "blog",
    label: "All /articles-all/ Traffic",
    sublabel: "Blog",
    short: "/articles-all/",
    match: containsSegment("/articles-all/"),
  },
  {
    id: "agent_profile",
    label: "Asumsi Agent Profile Traffic",
    sublabel: null,
    short: "Agent Profile",
    match: isAgentProfilePath,
  },
  {
    id: "agent",
    label: "Segment /agent/ Traffic",
    sublabel: "Search agen all, per kota, dan unit bisnis",
    short: "/agent/",
    match: startsWithSegment("agent"),
  },
  {
    id: "perumahan_baru",
    label: "All Perumahan Baru Traffic",
    sublabel: "Listing Page Primary",
    short: "Perumahan Baru",
    // Listing pages only — the detail pages under it are their own block.
    match: startsWithSegmentExcept("perumahan-baru", "viewdetail"),
  },
  {
    id: "perumahan_baru_detail",
    label: "All /perumahan-baru/viewdetail/ Traffic",
    sublabel: "Detail Page Primary",
    short: "/perumahan-baru/viewdetail/",
    match: containsSegment("/perumahan-baru/viewdetail/"),
  },
  {
    id: "dijualsewa",
    label: "All /dijualsewa/ Traffic",
    sublabel: "Listing Page Dijualsewa",
    short: "/dijualsewa/",
    match: startsWithSegment("dijualsewa"),
  },
];

export const SEGMENT_IDS = SEGMENTS.map((s) => s.id);
export const SEGMENTS_BY_ID = Object.fromEntries(
  SEGMENTS.map((s) => [s.id, s]),
);

/** Segments a mixed export can be split into (everything but the total). */
export const SPLITTABLE_SEGMENTS = SEGMENTS.filter((s) => s.match);

/**
 * The second table: GA4 by landing page rather than page path, for three of
 * the main segments. `blockIndex` is the main-table column block it sits
 * under, which is what keeps the two tables aligned in the sheet.
 */
export const ENTRY_SEGMENTS = [
  {
    id: "entry_dijual",
    base: "dijual",
    label: "Via Entry - All /dijual/ Traffic",
    blockIndex: 1,
  },
  {
    id: "entry_disewa",
    base: "disewa",
    label: "Via Entry - All /disewa/ Traffic",
    blockIndex: 2,
  },
  {
    id: "entry_blog",
    base: "blog",
    label: "Via Entry - All /articles-all/ Traffic",
    blockIndex: 4,
  },
];

export const ENTRY_SEGMENT_IDS = ENTRY_SEGMENTS.map((s) => s.id);

/**
 * Order used when deciding which single segment an export was filtered to.
 * Narrower rules come first, so that a file matching more than one rule is
 * read as the most specific of them.
 */
const DETECTION_ORDER = [
  "perumahan_baru_detail",
  "cari_properti_view",
  "blog",
  "dijualsewa",
  "dijual",
  "disewa",
  "agent",
  "perumahan_baru",
  "agent_profile",
];

/**
 * Tokens that identify a segment in a GA4 report title, e.g.
 * "# Report - Event Page Path-Event Disewa". The title is the only thing that
 * can separate an "All Perumahan Baru" export from a viewdetail-only one when
 * every row happens to be a viewdetail page, so it is consulted first — but
 * only to pick between segments the URLs already support.
 */
const TITLE_TOKENS = [
  ["perumahan_baru_detail", /viewdetail/i],
  ["perumahan_baru", /perumahan[\s-]?baru/i],
  ["cari_properti_view", /cari[\s-]?properti/i],
  ["agent_profile", /asumsi|agent\s*profil/i],
  ["dijualsewa", /dijualsewa/i],
  ["blog", /articles?[\s-]?all|\bblog\b/i],
  ["dijual", /\bdijual\b/i],
  ["disewa", /\bdisewa\b/i],
  ["agent", /\bagent\b/i],
];

/** Segment named by a GA4 report title, or null when it names none. */
export function segmentFromTitle(titleText) {
  const text = String(titleText ?? "");
  if (!text.trim()) return null;
  for (const [id, re] of TITLE_TOKENS) {
    if (re.test(text)) return id;
  }
  return null;
}

/**
 * Which single segment a list of URL paths was filtered to, or null when the
 * paths span several (an all-segments export) or there are too few to judge.
 *
 * A GA4 page-path filter is strict, so a segment-filtered export is ~100% one
 * segment; the 90% threshold just leaves room for a stray row.
 */
export function detectSegmentFromPaths(paths, titleText) {
  const usable = paths.filter((p) => normalizePath(p) !== null);
  const titleHint = segmentFromTitle(titleText);
  if (usable.length < 3) return titleHint;

  const candidates = DETECTION_ORDER.filter((id) => {
    const seg = SEGMENTS_BY_ID[id];
    let hits = 0;
    for (const p of usable) if (seg.match(p)) hits++;
    return hits / usable.length >= 0.9;
  });

  if (!candidates.length) return null;
  if (titleHint && candidates.includes(titleHint)) return titleHint;
  return candidates[0];
}

/**
 * Path prefixes that name a segment inside a GSC Page filter. Longest first,
 * so "/dijualsewa" is not read as "/dijual".
 */
const FILTER_TOKENS = [
  ["perumahan_baru_detail", "/perumahan-baru/viewdetail"],
  ["perumahan_baru", "/perumahan-baru"],
  ["cari_properti_view", "/cari-properti/view"],
  ["dijualsewa", "/dijualsewa"],
  ["blog", "/articles-all"],
  ["dijual", "/dijual"],
  ["disewa", "/disewa"],
  ["agent", "/agent"],
];

/**
 * A GSC Page filter is `+<pattern>` to keep only matching URLs or
 * `-<pattern>` to drop them. Older exports wrote prose ("URL contains
 * /dijual/") with no sign, which is an include.
 */
function splitPageFilter(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const sign = raw[0];
  if (sign === "+" || sign === "-")
    return { include: sign === "+", body: raw.slice(1).toLowerCase() };
  return { include: true, body: raw.toLowerCase() };
}

/**
 * True when `token` appears in `body` as a whole path prefix. The filter is a
 * regex, so what follows the token is as likely to be `(`, `|`, `\` or the
 * end of the pattern as it is `/` — anything that cannot continue a slug ends
 * it. Without this, `+/dijual(/|\?|$)` reads as naming no segment at all,
 * because the literal "/dijual/" it used to be matched on is not in it.
 */
function hasPathToken(body, token) {
  let at = body.indexOf(token);
  while (at !== -1) {
    const next = body[at + token.length];
    if (next === undefined || !/[a-z0-9-]/.test(next)) return true;
    at = body.indexOf(token, at + 1);
  }
  return false;
}

/**
 * Segment named by a GSC export's Filters sheet Page value, or null.
 *
 * Only an *include* filter is read. GSC writes an exclusion filter as a long
 * list of the areas being kept out — the Asumsi Agent Profile export is
 * defined as "every area except these" and names a dozen segments it is not —
 * so the tokens inside one describe everything the file does **not** contain.
 * Those fall through to the export's own URLs, which is also the only thing
 * that can identify an agent-profile export: it has no path of its own to
 * filter on.
 */
export function segmentFromFilterValue(value) {
  const filter = splitPageFilter(value);
  if (!filter || !filter.include) return null;
  for (const [id, token] of FILTER_TOKENS) {
    if (hasPathToken(filter.body, token)) return id;
  }
  return null;
}

/**
 * Which segment a GSC export covers: its Page filter when that names one,
 * otherwise the URLs on its Pages sheet. Returns null when neither settles it.
 */
export function detectGSCSegment(filterValue, paths = []) {
  return segmentFromFilterValue(filterValue) ?? detectSegmentFromPaths(paths);
}
