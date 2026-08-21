import { collection, deleteDoc, doc, getDocs, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";

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
 * Returns null if there's nothing to migrate.
 */
export function readLegacyLocalStorage() {
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

/** Writes a one-time legacy migration payload up to Firestore for `uid`. */
export async function persistLegacyMigration(uid, legacy) {
  if (Object.keys(legacy.state).length > 0) {
    await setDoc(doc(db, "users", uid, "data", "state"), legacy.state, {
      merge: true,
    });
  }
  for (const [prefix, obj] of Object.entries(legacy.chunks)) {
    await Promise.all(
      Object.entries(obj).map(([k, v]) =>
        setDoc(doc(db, "users", uid, prefix, k), { value: v }),
      ),
    );
  }
}

/** Deletes every chunk doc in `users/{uid}/{prefix}`. */
export async function clearChunkedCollection(uid, prefix) {
  const snap = await getDocs(collection(db, "users", uid, prefix));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
}
