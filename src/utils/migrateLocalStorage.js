import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../lib/firebase";

const FIRESTORE_BATCH_LIMIT = 500;

// Every simple (non-chunked) report-data key previously stored in
// localStorage via useStorage, excluding UI-only keys ("sidebarOpen", "theme")
// which stay local since they're per-browser display preferences, not report
// data.
export const REPORT_DATA_KEYS = [
  "google_oauth",
  "flow1_window",
  "flow2_window",
  "sheets_report_url",
  "bc_urls",
  "blog_urls",
  "flow1_log",
  "flow1_preview_tab",
  "flow1_import_mode",
  "flow1_sheet_url",
  "flow2_log",
  "flow2_import_mode",
  "flow2_sheet_url",
  "flow2_active_seg",
  "flow3_selected_slot",
  "flow3_date_range",
  "urls_active_tab",
  "urls_import_mode",
  "urls_import_sheet_url",
];

export const CHUNKED_PREFIXES = ["flow1_data", "flow2_data"];

const CHUNK_SEP = "::";

function readSimpleKeys() {
  const state = {};
  let found = false;
  for (const key of REPORT_DATA_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    try {
      state[key] = JSON.parse(raw);
      found = true;
    } catch {}
  }
  return found ? state : null;
}

function readChunkedPrefix(prefix) {
  const indexRaw = localStorage.getItem(prefix);
  if (indexRaw === null) return null;
  try {
    const parsed = JSON.parse(indexRaw);
    const result = {};
    if (Array.isArray(parsed)) {
      for (const k of parsed) {
        const raw = localStorage.getItem(prefix + CHUNK_SEP + k);
        if (raw !== null) {
          try {
            result[k] = JSON.parse(raw);
          } catch {}
        }
      }
    } else if (parsed && typeof parsed === "object") {
      // Pre-chunking single-blob format.
      Object.assign(result, parsed);
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Reads legacy localStorage report data (from before the Firebase migration)
 * so a user's first cloud login doesn't lose in-progress work.
 * Returns null if there's nothing to migrate, or if this browser has
 * already had a migration attempt (localStorage is shared by the browser,
 * not by account, so this must only ever be attempted once per browser —
 * otherwise a second person signing in on the same machine would inherit
 * the first person's leftover local data).
 */
const MIGRATION_FLAG_KEY = "cloud_migration_attempted";

export function readLegacyLocalStorage() {
  if (localStorage.getItem(MIGRATION_FLAG_KEY)) return null;
  const state = readSimpleKeys();
  const chunks = {};
  let hasChunks = false;
  for (const prefix of CHUNKED_PREFIXES) {
    const data = readChunkedPrefix(prefix);
    if (data && Object.keys(data).length > 0) {
      chunks[prefix] = data;
      hasChunks = true;
    }
  }
  if (!state && !hasChunks) return null;
  return { state: state || {}, chunks };
}

/**
 * Marks this browser as having had a migration attempt, so no future
 * login (by this account or any other) re-checks localStorage again.
 * Call this exactly once, right after the first empty-Firestore login
 * this browser encounters — regardless of whether anything was found.
 */
export function markLegacyMigrationAttempted() {
  try {
    localStorage.setItem(MIGRATION_FLAG_KEY, "1");
  } catch {}
}

/**
 * Writes a one-time legacy migration payload up to Firestore for `uid`.
 * Each key gets its own document (users/{uid}/data/{key}) so a large URL
 * list doesn't share — and potentially blow — another key's 1 MiB budget.
 */
export async function persistLegacyMigration(uid, legacy) {
  if (Object.keys(legacy.state).length > 0) {
    await Promise.all(
      Object.entries(legacy.state).map(([key, value]) =>
        setDoc(doc(db, "users", uid, "data", key), { value }),
      ),
    );
  }
  for (const [prefix, obj] of Object.entries(legacy.chunks)) {
    await Promise.all(
      Object.entries(obj).map(([k, v]) =>
        setDoc(doc(db, "users", uid, prefix, k), { value: v }),
      ),
    );
  }
}

/** Commits `refs` as delete batches, reporting each batch as it lands. */
async function deleteRefs(refs, report) {
  const batches = [];
  for (let i = 0; i < refs.length; i += FIRESTORE_BATCH_LIMIT) {
    const slice = refs.slice(i, i + FIRESTORE_BATCH_LIMIT);
    const batch = writeBatch(db);
    for (const ref of slice) batch.delete(ref);
    batches.push({ batch, size: slice.length });
  }
  await Promise.all(
    batches.map(({ batch, size }) => batch.commit().then(() => report(size))),
  );
}

/**
 * Deletes every document in `users/{uid}/{prefix}`.
 *
 * Deleting used to begin with getDocs over the whole collection purely to
 * learn the document ids — which downloads every document's contents, so
 * clearing a 7,000-row URL list first pulled the entire list down. The Web
 * SDK has no field projection, so that read cannot be made cheaper; it can
 * only be avoided. `knownIds` (the ids the app already holds in memory) are
 * deleted straight away with no read at all.
 *
 * A paged sweep then follows to catch anything the caller did not know
 * about — the orphaned documents that once left a "cleared" list still
 * populated after a reload. In the normal case that sweep's first query
 * comes back empty, costing one read instead of thousands.
 */
export async function clearChunkedCollection(uid, prefix, options = {}) {
  const { knownIds = [], onProgress } = options;
  const col = collection(db, "users", uid, prefix);

  let done = 0;
  let total = knownIds.length;
  const report = (n) => {
    done += n;
    if (done > total) total = done;
    onProgress?.(done, total);
  };
  onProgress?.(0, total);

  if (knownIds.length > 0) {
    await deleteRefs(
      knownIds.map((id) => doc(col, id)),
      report,
    );
  }

  // Sweep whatever remains, a page at a time. Deleted documents drop out of
  // the query, so each round naturally advances to the next page.
  for (;;) {
    const snap = await getDocs(query(col, limit(FIRESTORE_BATCH_LIMIT)));
    if (snap.empty) break;
    await deleteRefs(
      snap.docs.map((d) => d.ref),
      report,
    );
  }
}
