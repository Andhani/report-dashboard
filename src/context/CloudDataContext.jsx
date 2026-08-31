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
} from "firebase/firestore";
import { db } from "../lib/firebase";
import {
  commitOps,
  estimateBytes,
  isTransactionTooBig,
} from "../utils/firestoreBatch";
import { useAuth } from "./AuthContext";
import { shardsToDocs } from "../utils/rowShards";
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

/**
 * Firestore answers a exhausted daily quota with resource-exhausted and then
 * retries behind ever-longer backoff, so the symptom is a save that never
 * finishes rather than one that fails. Naming it turns a mystery stall into
 * something actionable.
 */
export function describeWriteError(err) {
  if (err?.code === "resource-exhausted") {
    return (
      "Firestore's daily quota is used up, so writes are being refused. " +
      "The free plan allows 20,000 writes and 20,000 deletes per day, and " +
      "one import of a large URL list uses thousands. It resets at midnight " +
      "US Pacific, or upgrade the Firebase project to the pay-as-you-go plan " +
      "to lift the cap."
    );
  }
  if (err?.code === "permission-denied") {
    return "Firestore refused the write — check the security rules are published.";
  }
  if (err?.code === "unavailable") {
    return "Couldn't reach Firestore. Check your connection and try again.";
  }
  if (isTransactionTooBig(err)) {
    // Reached only if the split-and-retry in firestoreBatch.js ran out of
    // room to split, so say what it means rather than echoing Firestore.
    return (
      "Firestore refused a batch for holding too much data at once. " +
      "Nothing was lost — try again, and it will be sent in smaller pieces."
    );
  }
  return err?.message || "The save didn't complete.";
}

// Chunked collections (bc_urls/blog_urls, flow1_data/flow2_data) can hold
// hundreds of documents, so a full re-import or clear used to fire one
// setDoc/deleteDoc network round trip per document — which is what made
// large lists (7k+ BC URLs) feel laggy on save. Batching collapses that into
// a handful of round trips.
//
// The packing rules — 500 operations per batch, a payload ceiling well under
// Firestore's ~10 MiB commit limit, and anything near the 1 MiB document
// limit committed alone — live in utils/firestoreBatch.js, shared with the
// collection-clearing code so both sides of a delete obey the same limits.

/**
 * Applies `sets` (`[id, value]`) and `deletes` (`[id, previousValue]`) to
 * `users/{uid}/{prefix}` as size-capped batches.
 *
 * `deletes` carries the value being removed, not just its id, because a
 * delete is not a free operation inside a transaction: Firestore counts the
 * document it removes. Treating deletes as weightless is what let a clear of
 * shard-sized documents pack a single commit far past the limit and come
 * back as "Transaction too big. Decrease transaction size." with nothing
 * deleted.
 */
async function commitChunkOps(uid, prefix, sets, deletes, onProgress) {
  const ops = [];
  for (const [id, value] of sets) {
    // A single stringify does double duty: it strips `undefined` the same
    // forgiving way sanitizeForFirestore does, and measures the payload so
    // batches can be packed by size.
    const json = JSON.stringify(value ?? null) ?? "null";
    const data = { value: JSON.parse(json) };
    ops.push({
      bytes: json.length,
      apply: (batch) => batch.set(doc(db, "users", uid, prefix, id), data),
    });
  }
  for (const [id, previousValue] of deletes) {
    ops.push({
      bytes: estimateBytes(previousValue),
      apply: (batch) => batch.delete(doc(db, "users", uid, prefix, id)),
    });
  }

  // Progress is reported per batch as it lands. Hundreds of documents take
  // real seconds to write, and without that count the UI can only show a
  // finished state that isn't true yet.
  await commitOps(ops, { onProgress });
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
      // single flat array field (whichever source it came from above — the
      // old shared "state" doc, an old regular per-key doc, or a fresh
      // localStorage import). A large list in that form could exceed
      // Firestore's 1 MiB document limit and silently fail to save, so it
      // is split across shard documents here. Rows already stored one per
      // document are left alone: useCloudArrayStorage reads that layout and
      // re-shards it on the next save, which avoids spending thousands of
      // writes during a page load.
      //
      // The flat document must not survive a successful migration, and must
      // not survive a load that finds shards already in place either: a
      // leftover copy is re-adopted by every later load, so clearing the
      // list deletes the shards and the next reload rebuilds them from the
      // stale array — the list comes back from the dead. It is only kept
      // when the shard write failed and it is therefore still the sole copy.
      for (const key of ARRAY_CHUNK_KEYS) {
        const hasFlatDoc = Object.prototype.hasOwnProperty.call(
          finalState,
          key,
        );
        const flatArray = finalState[key];
        const hasShards = Object.keys(finalChunks[key] || {}).length > 0;
        let flatDocIsOnlyCopy = false;

        if (!hasShards && Array.isArray(flatArray) && flatArray.length > 0) {
          const shardDocs = shardsToDocs(flatArray);
          try {
            await commitChunkOps(uid, key, Object.entries(shardDocs), []);
          } catch (err) {
            console.error(`CloudData: array migration for "${key}" failed:`, err);
            // Sharding is what makes the rows deletable and editable, so
            // say so rather than leaving a list that silently won't save.
            writeErrorsRef.current[key] = describeWriteError(err);
            flatDocIsOnlyCopy = true;
          }
          finalChunks = { ...finalChunks, [key]: shardDocs };
        }

        if (hasFlatDoc && !flatDocIsOnlyCopy) {
          await deleteDoc(doc(db, "users", uid, "data", key)).catch((err) =>
            console.error(`CloudData: dropping legacy "${key}" doc failed:`, err),
          );
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

  // A delete that failed must never leave the page claiming the data is
  // gone: the documents are still in Firestore and come back on the next
  // reload, which is exactly how a cleared slot reappeared after a refresh.
  // Entries are put back wherever nothing has since replaced them, so what
  // is on screen matches what is stored.
  const restoreChunkDocs = useCallback((prefix, entries) => {
    if (entries.length === 0) return;
    setChunkedState((prevAll) => {
      const current = prevAll[prefix] ?? {};
      const merged = { ...current };
      let changed = false;
      for (const [id, value] of entries) {
        if (Object.prototype.hasOwnProperty.call(merged, id)) continue;
        merged[id] = value;
        changed = true;
      }
      return changed ? { ...prevAll, [prefix]: merged } : prevAll;
    });
  }, []);

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

      const fail = (err, restore) => {
        writeErrorsRef.current[prefix] = describeWriteError(err);
        restoreChunkDocs(prefix, restore);
        console.error(`CloudData: chunk write "${prefix}" failed:`, err);
        bump((n) => n + 1);
        throw err;
      };

      // Clearing the collection outright. The ids in memory only seed the
      // delete; a paged sweep then removes whatever else the collection
      // holds. Local state and Firestore can disagree — a write that failed
      // after the UI had moved on, another tab, a load that raced an
      // in-flight write — and a clear that covers only the ids this session
      // happens to know about is how a "cleared" tab came back populated.
      if (
        next === null ||
        next === undefined ||
        Object.keys(next).length === 0
      ) {
        setChunkedState((prevAll) => ({ ...prevAll, [prefix]: {} }));
        return trackWrite(
          clearChunkedCollection(uid, prefix, {
            // The whole in-memory copy, not just its ids: knowing each
            // document's size is what keeps the delete batches inside
            // Firestore's commit limit.
            knownDocs: prev,
            onProgress,
          }).catch((err) => fail(err, Object.entries(prev))),
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
      // Entries, not bare ids: the value being deleted is what the batch
      // packer weighs it by.
      const toDelete = [];
      for (const k of Object.keys(prev)) {
        if (!Object.prototype.hasOwnProperty.call(next, k)) {
          toDelete.push([k, prev[k]]);
        }
      }

      setChunkedState((prevAll) => ({ ...prevAll, [prefix]: next }));

      if (toSet.length === 0 && toDelete.length === 0) return Promise.resolve();

      return trackWrite(
        commitChunkOps(uid, prefix, toSet, toDelete, onProgress).catch((err) =>
          fail(err, toDelete),
        ),
      );
    },
    [restoreChunkDocs, uid],
  );

  const clearAll = useCallback(async () => {
    if (!uid) return;
    // All collections at once rather than the settings document first and
    // the rest after — they are independent, and the row collections are
    // what take the time. Each is seeded with the ids already in memory so
    // it can start deleting without reading itself back.
    await Promise.all([
      clearChunkedCollection(uid, "data", {
        knownDocs: stateDocRef.current,
      }),
      ...ALL_CHUNK_PREFIXES.map((prefix) =>
        clearChunkedCollection(uid, prefix, {
          knownDocs: chunkedRef.current[prefix] ?? {},
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
        knownDocs: chunkedRef.current[key] ?? {},
        onProgress,
      });
      // Every copy of the list, not just the shards: the per-row layout's
      // order document, and the pre-shard flat array that a migrated
      // account can still be holding in users/{uid}/data/{key}. Leaving
      // that last one behind meant the next load re-sharded it and the
      // cleared list reappeared.
      await Promise.all(
        [`${key}_order`, key].map((id) =>
          deleteDoc(doc(db, "users", uid, "data", id)).catch(() => {}),
        ),
      );
      setChunkedState((prevAll) => ({ ...prevAll, [key]: {} }));
      setStateDocState((prev) => {
        const next = { ...prev };
        delete next[`${key}_order`];
        delete next[key];
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
