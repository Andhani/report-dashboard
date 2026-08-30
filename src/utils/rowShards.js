// Row lists are stored as a handful of "shard" documents holding many rows
// each, rather than one document per row.
//
// One document per row was chosen to escape Firestore's 1 MiB per-document
// limit, which a single array of thousands of rows would breach. It works,
// but it spends quota per row: importing a 7,714-row list is 7,714 writes,
// clearing it 7,714 deletes, loading it 7,714 reads. The free plan allows
// 20,000 of each per day, so two ordinary actions exhaust it — which is
// what "quota exceeded" was.
//
// Packing rows into shards keeps the list well under the document limit
// while making every operation proportional to the number of shards, not
// the number of rows. The same 7,714-row list becomes roughly sixteen
// documents: sixteen writes, sixteen deletes, sixteen reads.

export const SHARD_PREFIX = "shard-";

// Comfortably inside the 1 MiB document limit, with room for a row far
// larger than any real one. The row cap is a second guard so a list of tiny
// rows still splits into a few documents rather than one enormous array.
const MAX_SHARD_BYTES = 400 * 1024;
const MAX_SHARD_ROWS = 2000;

export function shardId(index) {
  return `${SHARD_PREFIX}${String(index).padStart(6, "0")}`;
}

export function isShardId(id) {
  return typeof id === "string" && id.startsWith(SHARD_PREFIX);
}

/**
 * Splits `rows` into shard arrays, filling each until it reaches either
 * byte or row budget. A single row larger than the byte budget still gets
 * its own shard rather than being dropped.
 */
export function packRows(rows) {
  const shards = [];
  let current = [];
  let bytes = 0;

  for (const row of rows) {
    const size = JSON.stringify(row ?? null)?.length ?? 4;
    if (
      current.length > 0 &&
      (current.length >= MAX_SHARD_ROWS || bytes + size > MAX_SHARD_BYTES)
    ) {
      shards.push(current);
      current = [];
      bytes = 0;
    }
    current.push(row);
    bytes += size;
  }
  if (current.length > 0) shards.push(current);
  return shards;
}

/** Turns `rows` into the { docId: rows[] } map the storage layer writes. */
export function shardsToDocs(rows) {
  const docs = {};
  packRows(rows).forEach((shard, i) => {
    docs[shardId(i)] = shard;
  });
  return docs;
}

/**
 * Rebuilds the row list from whatever documents the collection holds.
 *
 * Shards win when present. Anything else is a leftover per-row document
 * from the previous layout, read only while no shards exist yet — the next
 * save writes shards and the storage layer deletes the leftovers, since
 * they are absent from what it is asked to store.
 */
// ── Splitting a single keyed value whose `rows` array is the bulk of it ──
//
// Flow 1/2 store one uploaded export per document, as
// { rows, file, chartAgg, grandTotal }. A GA4 export of a large segment
// runs past Firestore's 1 MiB document limit — a BC /dijual/ month of
// 7,380 URLs measured 1.17 MB — and the write is rejected outright.
//
// The value is therefore spread across numbered part documents, each
// carrying a slice of `rows`. Everything except `rows` rides on part 0 and
// is restored around the rejoined rows, so consumers receive exactly the
// object they stored: the compute functions must not be able to tell.

const PART_SEP = "~~";
const MAX_PART_BYTES = 400 * 1024;

function partId(baseKey, index) {
  return `${baseKey}${PART_SEP}${String(index).padStart(3, "0")}`;
}

/** Splits one { rows, ...meta } value into part documents. */
export function splitKeyedValue(baseKey, value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.rows)) {
    // Nothing row-shaped to split — store as-is under its own key.
    return { [baseKey]: value };
  }
  const { rows, ...meta } = value;
  const groups = packRows(rows);
  // Preserve an empty rows array rather than collapsing it to no parts.
  if (groups.length === 0) groups.push([]);

  const docs = {};
  groups.forEach((slice, i) => {
    docs[partId(baseKey, i)] =
      i === 0
        ? {
            __part: 0,
            __parts: groups.length,
            // Property order is recorded so rejoining reproduces the stored
            // object exactly, not merely an equivalent one. Nothing reads
            // these by position, but an identical object is a guarantee
            // worth being able to make about data the report maths consumes.
            keys: Object.keys(value),
            meta,
            rows: slice,
          }
        : { __part: i, __parts: groups.length, rows: slice };
  });
  return docs;
}

/** Splits a whole { key: value } map into part documents. */
export function splitKeyedMap(valuesByKey) {
  const docs = {};
  for (const [key, value] of Object.entries(valuesByKey)) {
    Object.assign(docs, splitKeyedValue(key, value));
  }
  return docs;
}

/**
 * Rebuilds { key: value } from part documents, tolerating values written
 * before splitting existed — those sit under a plain key with no separator
 * and are returned unchanged.
 */
export function joinKeyedDocs(docsById) {
  const parts = new Map();
  const result = {};

  for (const [id, value] of Object.entries(docsById)) {
    const sep = id.lastIndexOf(PART_SEP);
    const looksLikePart =
      sep > 0 && value && typeof value === "object" && "__part" in value;
    if (!looksLikePart) {
      result[id] = value;
      continue;
    }
    const baseKey = id.slice(0, sep);
    if (!parts.has(baseKey)) parts.set(baseKey, []);
    parts.get(baseKey).push(value);
  }

  for (const [baseKey, group] of parts) {
    group.sort((a, b) => (a.__part ?? 0) - (b.__part ?? 0));
    const rows = [];
    let meta = {};
    let keys = null;
    for (const part of group) {
      if (part.__part === 0) {
        if (part.meta) meta = part.meta;
        if (Array.isArray(part.keys)) keys = part.keys;
      }
      if (Array.isArray(part.rows)) rows.push(...part.rows);
    }
    if (keys) {
      // Rebuild in the order the value was stored in.
      const value = {};
      for (const k of keys) value[k] = k === "rows" ? rows : meta[k];
      result[baseKey] = value;
    } else {
      result[baseKey] = { ...meta, rows };
    }
  }
  return result;
}

export function docsToRows(docsById, legacyOrder) {
  const shardIds = [];
  const legacyIds = [];
  for (const id of Object.keys(docsById)) {
    (isShardId(id) ? shardIds : legacyIds).push(id);
  }

  if (shardIds.length > 0) {
    shardIds.sort();
    const rows = [];
    for (const id of shardIds) {
      const value = docsById[id];
      if (Array.isArray(value)) rows.push(...value);
    }
    return { rows, migrated: legacyIds.length === 0 };
  }

  if (legacyIds.length === 0) return { rows: [], migrated: true };

  // Legacy layout: one row per document, ordered by a separate order doc.
  const seen = new Set();
  const rows = [];
  if (Array.isArray(legacyOrder)) {
    for (const id of legacyOrder) {
      if (Object.prototype.hasOwnProperty.call(docsById, id)) {
        rows.push(docsById[id]);
        seen.add(id);
      }
    }
  }
  for (const id of legacyIds) {
    if (!seen.has(id)) rows.push(docsById[id]);
  }
  return { rows, migrated: false };
}
