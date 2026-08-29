import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "./AuthContext";
import {
  CHUNKED_PREFIXES,
  clearChunkedCollection,
  markLegacyMigrationAttempted,
  persistLegacyMigration,
  readLegacyLocalStorage,
} from "../utils/migrateLocalStorage";

const WRITE_DEBOUNCE_MS = 400;

// bc_urls/blog_urls are row lists that can grow past Firestore's 1 MiB
// single-document limit (thousands of rows), so — like flow1_data/flow2_data
// — they're chunked one document per row instead of living as one array
// field. Distinct from CHUNKED_PREFIXES (which also governs the legacy
// localStorage chunked-format reader in migrateLocalStorage.js — these two
// keys were never stored that way in localStorage, only as a plain array).
const ARRAY_CHUNK_KEYS = ["bc_urls", "blog_urls"];
const ALL_CHUNK_PREFIXES = [...CHUNKED_PREFIXES, ...ARRAY_CHUNK_KEYS];

const CloudDataContext = createContext(null);

function emptyChunked() {
  return Object.fromEntries(ALL_CHUNK_PREFIXES.map((p) => [p, {}]));
}

// Firestore's setDoc() throws synchronously on any `undefined` field, even
// nested deep inside an array/object — unlike JSON.stringify (what the old
// localStorage code used), which just drops undefined values silently. Real
// imported rows commonly have undefined for a metric a file didn't report,
// so writes must be sanitized the same forgiving way before reaching
// Firestore, or a single bad row can throw mid-render and blank the page.
function sanitizeForFirestore(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

// Firestore caps a single batch at 500 writes. Row-chunked collections
// (bc_urls/blog_urls) can hold thousands of docs, so a full re-import or
// clear used to fire one setDoc/deleteDoc network round trip per row —
// thousands of concurrent requests the browser and Firestore SDK both have
// to queue through, which is what made large lists (7k+ BC URLs) feel
// laggy on save. Batching collapses that into a handful of round trips.
const FIRESTORE_BATCH_LIMIT = 500;

// Firestore also caps a single commit *request* at ~10 MiB, independent of
// the operation count. flow1_data/flow2_data chunks are whole parsed
// exports and can each approach the 1 MiB per-document limit, so packing
// 500 of those into one commit would blow that ceiling — and because a
// batch is all-or-nothing, it would fail writes that would have succeeded
// on their own. Batches are therefore capped by payload size as well as
// count, with any single oversized document committed alone, exactly the
// way it behaved before batching existed. Half the ceiling leaves room for
// request overhead and multi-byte characters (length counts UTF-16 units,
// not bytes).
const MAX_BATCH_BYTES = 5 * 1024 * 1024;

async function commitChunkOps(uid, prefix, sets, deletes, onProgress) {
  const ops = [];
  for (const [id, value] of sets) {
    // A single stringify does double duty: it strips `undefined` the same
    // forgiving way sanitizeForFirestore does, and measures the payload so
    // batches can be packed by size.
    const json = JSON.stringify(value ?? null) ?? "null";
    ops.push({ type: "set", id, value: JSON.parse(json), bytes: json.length });
  }
  for (const id of deletes) {
    ops.push({ type: "delete", id, bytes: 0 });
  }

  // Batches are collected before committing so the caller can be told how
  // many operations have actually landed. Thousands of rows take real
  // seconds to write, and without that count the UI can only show a
  // finished state that isn't true yet.
  const batches = [];
  let batch = null;
  let count = 0;
  let bytes = 0;

  const flush = () => {
    if (batch) batches.push({ batch, size: count });
    batch = null;
    count = 0;
    bytes = 0;
  };

  for (const op of ops) {
    if (
      batch &&
      (count >= FIRESTORE_BATCH_LIMIT || bytes + op.bytes > MAX_BATCH_BYTES)
    ) {
      flush();
    }
    if (!batch) batch = writeBatch(db);
    const ref = doc(db, "users", uid, prefix, op.id);
    if (op.type === "set") {
      batch.set(ref, { value: op.value });
    } else {
      batch.delete(ref);
    }
    count += 1;
    bytes += op.bytes;
  }
  flush();

  const total = ops.length;
  let landed = 0;
  onProgress?.(0, total);
  await Promise.all(
    batches.map(({ batch: b, size }) =>
      b.commit().then(() => {
        landed += size;
        onProgress?.(landed, total);
      }),
    ),
  );
}

/**
 * Firestore-backed replacement for the localStorage data layer
 * (useStorage/useChunkedStorage). Loads a signed-in, approved user's report
 * data once (gating ProtectedRoute's <Outlet/> via `ready`), then serves
 * useCloudStorage/useChunkedCloudStorage from this single in-memory copy so
 * sibling hook instances on the same page don't each issue their own reads.
 *
 * Each simple key (bc_urls, flow1_window, google_oauth, ...) gets its own
 * document in the `users/{uid}/data` subcollection rather than sharing one
 * document — Firestore caps a single document at 1 MiB, and a large URL
 * list sharing that budget with other settings can silently push the whole
 * document over the limit, failing writes for keys that had nothing to do
 * with the oversized one.
 */
export function CloudDataProvider({ children }) {
  const { user, role } = useAuth();
  const uid = user?.uid;
  const active = !!uid && !!role;

  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [stateDoc, setStateDocState] = useState({});
  const [chunked, setChunkedState] = useState(emptyChunked());
  const writeErrorsRef = useRef({});
  const [, bump] = useState(0);

  const retryLoad = useCallback(() => setReloadNonce((n) => n + 1), []);

  useEffect(() => {
    if (!active) {
      setReady(false);
      setLoadError(null);
      setStateDocState({});
      setChunkedState(emptyChunked());
      return;
    }
    let cancelled = false;
    setLoadError(null);
    (async () => {
      const dataSnap = await getDocs(collection(db, "users", uid, "data"));
      let hasAnyKey = false;
      const fetchedState = {};
      let legacyStateDoc = null;
      dataSnap.forEach((d) => {
        // Pre-fix schema: every key lived as a field on one "state" doc
        // instead of its own document. Handled as a one-time migration
        // below rather than a normal fetched key.
        if (d.id === "state") {
          legacyStateDoc = d.data();
          return;
        }
        hasAnyKey = true;
        fetchedState[d.id] = d.data().value;
      });

      // Fetched in parallel rather than one collection at a time — with
      // thousands of row docs in bc_urls/blog_urls, sequential awaits here
      // meant every other chunked collection sat idle waiting on the
      // biggest one before the page could even render.
      const chunkResults = {};
      const chunkSnaps = await Promise.all(
        ALL_CHUNK_PREFIXES.map((prefix) =>
          getDocs(collection(db, "users", uid, prefix)),
        ),
      );
      ALL_CHUNK_PREFIXES.forEach((prefix, i) => {
        const obj = {};
        chunkSnaps[i].forEach((d) => {
          obj[d.id] = d.data().value;
        });
        chunkResults[prefix] = obj;
      });
      if (cancelled) return;

      let finalState = hasAnyKey ? fetchedState : null;
      let finalChunks = chunkResults;

      if (finalState === null) {
        if (legacyStateDoc && Object.keys(legacyStateDoc).length > 0) {
          // Old shared-document schema — adopt it as-is, then migrate each
          // field to its own document and drop the old one.
          finalState = legacyStateDoc;
          try {
            await Promise.all(
              Object.entries(legacyStateDoc).map(([key, value]) =>
                setDoc(doc(db, "users", uid, "data", key), { value }),
              ),
            );
            await deleteDoc(doc(db, "users", uid, "data", "state"));
          } catch (err) {
            console.error("CloudData: old-schema migration failed:", err);
          }
        } else {
          const legacy = readLegacyLocalStorage();
          markLegacyMigrationAttempted();
          if (legacy) {
            finalState = legacy.state;
            finalChunks = { ...chunkResults, ...legacy.chunks };
            try {
              await persistLegacyMigration(uid, legacy);
            } catch (err) {
              console.error("CloudData: legacy migration failed:", err);
            }
          } else {
            finalState = {};
          }
        }
      }

      // One-time per-account migration: bc_urls/blog_urls used to live as a
      // single flat array field (whichever source it came from above —
      // the old shared "state" doc, an old regular per-key doc, or a fresh
      // localStorage import) before being chunked one-document-per-row. A
      // large list in that flat form could exceed Firestore's 1 MiB
      // document limit and silently fail to save at all — this is the fix
      // for that, splitting any surviving flat array into per-row docs.
      for (const key of ARRAY_CHUNK_KEYS) {
        const flatArray = finalState[key];
        if (
          Array.isArray(flatArray) &&
          flatArray.length > 0 &&
          Object.keys(finalChunks[key] || {}).length === 0
        ) {
          const rowsObj = {};
          flatArray.forEach((row) => {
            if (row && row.id) rowsObj[row.id] = row;
          });
          try {
            await commitChunkOps(uid, key, Object.entries(rowsObj), []);
            await setDoc(doc(db, "users", uid, "data", `${key}_order`), {
              value: flatArray.map((r) => r.id),
            });
            await deleteDoc(doc(db, "users", uid, "data", key));
          } catch (err) {
            console.error(`CloudData: array migration for "${key}" failed:`, err);
          }
          finalChunks = { ...finalChunks, [key]: rowsObj };
          finalState[`${key}_order`] = flatArray.map((r) => r.id);
        }
        delete finalState[key];
      }

      if (cancelled) return;
      setStateDocState(finalState);
      setChunkedState(finalChunks);
      setReady(true);
    })().catch((err) => {
      if (cancelled) return;
      // A failed load must never fall through to ready-with-empty-data:
      // the app would render as though this account had no reports, and
      // the next debounced write would persist that emptiness over real
      // cloud data. Surface it and let the user retry instead — an
      // explicit error beats both silent data loss and an endless spinner.
      console.error("CloudData: initial load failed:", err);
      setLoadError(err?.message || "Could not load your data.");
    });
    return () => {
      cancelled = true;
    };
  }, [uid, active, reloadNonce]);

  // ── Flat key/value state (mirrors useStorage) ──────────────────────────
  // stateDocRef mirrors `stateDoc` synchronously so setStateKey can resolve
  // functional updaters and issue writes OUTSIDE the React state updater —
  // updater functions must be pure, and React 18 StrictMode deliberately
  // double-invokes them in dev to catch exactly this kind of side effect,
  // which was silently sending every sync write to Firestore twice.
  const stateDocRef = useRef(stateDoc);
  stateDocRef.current = stateDoc;
  const timersRef = useRef({});
  const pendingRef = useRef({});
  const pendingWritesRef = useRef(new Set());

  function trackWrite(promise) {
    pendingWritesRef.current.add(promise);
    const untrack = () => pendingWritesRef.current.delete(promise);
    promise.then(untrack, untrack);
    return promise;
  }

  const persistStateKey = useCallback(
    (key, next) => {
      if (!uid) return Promise.resolve();
      return trackWrite(
        setDoc(doc(db, "users", uid, "data", key), {
          value: sanitizeForFirestore(next),
        }).catch((err) => console.error(`CloudData: write "${key}" failed:`, err)),
      );
    },
    [uid],
  );

  const setStateKey = useCallback(
    (key, newValue, { sync = false, defaultValue } = {}) => {
      const prevAll = stateDocRef.current;
      const base = Object.prototype.hasOwnProperty.call(prevAll, key)
        ? prevAll[key]
        : defaultValue;
      const next = typeof newValue === "function" ? newValue(base) : newValue;
      setStateDocState((prev) => ({ ...prev, [key]: next }));
      if (sync) {
        // Returned so a caller doing a multi-part save (rows plus the
        // order document) can wait for the whole thing.
        return persistStateKey(key, next);
      } else {
        pendingRef.current[key] = next;
        clearTimeout(timersRef.current[key]);
        timersRef.current[key] = setTimeout(() => {
          persistStateKey(key, pendingRef.current[key]);
          delete pendingRef.current[key];
        }, WRITE_DEBOUNCE_MS);
      }
    },
    [persistStateKey],
  );

  const flushPendingWrites = useCallback(async () => {
    Object.entries(pendingRef.current).forEach(([key, next]) => {
      clearTimeout(timersRef.current[key]);
      persistStateKey(key, next);
    });
    pendingRef.current = {};
    await Promise.all([...pendingWritesRef.current]);
  }, [persistStateKey]);

  useEffect(() => {
    function handleBeforeUnload(e) {
      const hadPending =
        Object.keys(pendingRef.current).length > 0 ||
        pendingWritesRef.current.size > 0;
      Object.entries(pendingRef.current).forEach(([key, next]) => {
        clearTimeout(timersRef.current[key]);
        persistStateKey(key, next);
      });
      pendingRef.current = {};
      // Can't await inside beforeunload — this is the best available
      // signal: warn so the user can choose to wait a moment before
      // actually leaving, instead of losing a write silently.
      if (hadPending) {
        e.preventDefault();
        e.returnValue = "Changes are still saving.";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [persistStateKey]);

  // ── Chunked collections (mirrors useChunkedStorage) ────────────────────
  const chunkedRef = useRef(chunked);
  chunkedRef.current = chunked;

  // Returns a promise that settles when every write has actually landed in
  // Firestore. Callers that show a "saved" state — or that let the user
  // navigate away — must await it: a large list is thousands of documents
  // across many batched round trips, and treating the call as instant is
  // how a 7,700-row import comes back as 5,000 after a reload.
  const setChunkedValue = useCallback(
    (prefix, newValue, defaultValue = {}, { onProgress, compareByValue } = {}) => {
      const prev = chunkedRef.current[prefix] ?? defaultValue;
      const next = typeof newValue === "function" ? newValue(prev) : newValue;
      writeErrorsRef.current[prefix] = null;

      if (!uid) return Promise.resolve();

      if (next === null || next === undefined) {
        const keys = Object.keys(prev);
        setChunkedState((prevAll) => ({ ...prevAll, [prefix]: {} }));
        if (keys.length === 0) return Promise.resolve();
        return trackWrite(
          commitChunkOps(uid, prefix, [], keys, onProgress).catch(() => {}),
        );
      }

      // Reference equality catches untouched entries cheaply. compareByValue
      // adds a contents check for callers whose values are small and always
      // freshly built — re-importing a list produces all-new row objects, so
      // by reference every row looks changed and gets rewritten even when
      // the data is identical. Only ever skips a write when the stored
      // contents already match, so an inconclusive comparison just means a
      // redundant write, never a lost one. Off by default: the flow data
      // chunks are large enough that serialising them to compare would cost
      // more than the write it might save.
      const toSet = [];
      for (const [k, v] of Object.entries(next)) {
        if (prev[k] === v) continue;
        if (
          compareByValue &&
          k in prev &&
          JSON.stringify(prev[k]) === JSON.stringify(v)
        ) {
          continue;
        }
        toSet.push([k, v]);
      }
      const toDelete = [];
      for (const k of Object.keys(prev)) {
        if (!Object.prototype.hasOwnProperty.call(next, k)) toDelete.push(k);
      }

      setChunkedState((prevAll) => ({ ...prevAll, [prefix]: next }));

      if (toSet.length === 0 && toDelete.length === 0) return Promise.resolve();

      return trackWrite(
        commitChunkOps(uid, prefix, toSet, toDelete, onProgress).catch((err) => {
          writeErrorsRef.current[prefix] =
            "Cloud sync failed for some data — kept in memory but may not survive a refresh.";
          console.error(`CloudData: chunk write "${prefix}" failed:`, err);
          bump((n) => n + 1);
          throw err;
        }),
      );
    },
    [uid],
  );

  const clearAll = useCallback(async () => {
    if (!uid) return;
    // All collections at once rather than the settings document first and
    // the rest after — they are independent, and the row collections are
    // what take the time. Each is seeded with the ids already in memory so
    // it can start deleting without reading itself back.
    await Promise.all([
      clearChunkedCollection(uid, "data", {
        knownIds: Object.keys(stateDocRef.current),
      }),
      ...ALL_CHUNK_PREFIXES.map((prefix) =>
        clearChunkedCollection(uid, prefix, {
          knownIds: Object.keys(chunkedRef.current[prefix] ?? {}),
        }),
      ),
    ]);
    setStateDocState({});
    setChunkedState(emptyChunked());
  }, [uid]);

  // Deletes every row document for an array-chunked key (bc_urls/blog_urls)
  // by querying Firestore directly, rather than diffing against local React
  // state like setChunkedValue does — local state and Firestore can briefly
  // disagree after a race (a debounced write landing late, a fetch that
  // started before an in-flight write settled), and a "clear" action should
  // never leave real documents behind just because the local cache didn't
  // know about them.
  const clearArrayKey = useCallback(
    async (key, onProgress) => {
      if (!uid) return;
      // Handing over the ids already in memory lets the delete skip reading
      // the collection back first — for a large URL list that read was the
      // slowest part of clearing it.
      await clearChunkedCollection(uid, key, {
        knownIds: Object.keys(chunkedRef.current[key] ?? {}),
        onProgress,
      });
      await deleteDoc(doc(db, "users", uid, "data", `${key}_order`)).catch(() => {});
      setChunkedState((prevAll) => ({ ...prevAll, [key]: {} }));
      setStateDocState((prev) => {
        const next = { ...prev };
        delete next[`${key}_order`];
        return next;
      });
    },
    [uid],
  );

  return (
    <CloudDataContext.Provider
      value={{
        ready,
        loadError,
        retryLoad,
        stateDoc,
        setStateKey,
        chunked,
        setChunkedValue,
        writeErrors: writeErrorsRef.current,
        clearAll,
        flushPendingWrites,
        clearArrayKey,
      }}
    >
      {children}
    </CloudDataContext.Provider>
  );
}

export function useCloudData() {
  const ctx = useContext(CloudDataContext);
  if (!ctx) throw new Error("useCloudData must be used inside CloudDataProvider");
  return ctx;
}
