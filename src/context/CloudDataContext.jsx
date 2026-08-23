import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { collection, deleteDoc, doc, getDocs, setDoc } from "firebase/firestore";
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
  const [stateDoc, setStateDocState] = useState({});
  const [chunked, setChunkedState] = useState(emptyChunked());
  const writeErrorsRef = useRef({});
  const [, bump] = useState(0);

  useEffect(() => {
    if (!active) {
      setReady(false);
      setStateDocState({});
      setChunkedState(emptyChunked());
      return;
    }
    let cancelled = false;
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

      const chunkResults = {};
      for (const prefix of ALL_CHUNK_PREFIXES) {
        const snap = await getDocs(collection(db, "users", uid, prefix));
        const obj = {};
        snap.forEach((d) => {
          obj[d.id] = d.data().value;
        });
        chunkResults[prefix] = obj;
      }
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
            await Promise.all(
              Object.entries(rowsObj).map(([id, row]) =>
                setDoc(doc(db, "users", uid, key, id), { value: row }),
              ),
            );
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
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, active]);

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
      if (!uid) return;
      trackWrite(
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
        persistStateKey(key, next);
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

  const setChunkedValue = useCallback(
    (prefix, newValue, defaultValue = {}) => {
      const prev = chunkedRef.current[prefix] ?? defaultValue;
      const next = typeof newValue === "function" ? newValue(prev) : newValue;
      writeErrorsRef.current[prefix] = null;

      if (!uid) return;

      if (next === null || next === undefined) {
        Object.keys(prev).forEach((k) => {
          trackWrite(deleteDoc(doc(db, "users", uid, prefix, k)).catch(() => {}));
        });
        setChunkedState((prevAll) => ({ ...prevAll, [prefix]: {} }));
        return;
      }

      for (const [k, v] of Object.entries(next)) {
        if (prev[k] !== v) {
          trackWrite(
            setDoc(doc(db, "users", uid, prefix, k), {
              value: sanitizeForFirestore(v),
            }).catch((err) => {
              writeErrorsRef.current[prefix] =
                "Cloud sync failed for some data — kept in memory but may not survive a refresh.";
              console.error(`CloudData: chunk write "${prefix}/${k}" failed:`, err);
              bump((n) => n + 1);
            }),
          );
        }
      }
      for (const k of Object.keys(prev)) {
        if (!Object.prototype.hasOwnProperty.call(next, k)) {
          trackWrite(deleteDoc(doc(db, "users", uid, prefix, k)).catch(() => {}));
        }
      }

      setChunkedState((prevAll) => ({ ...prevAll, [prefix]: next }));
    },
    [uid],
  );

  const clearAll = useCallback(async () => {
    if (!uid) return;
    await clearChunkedCollection(uid, "data");
    await Promise.all(ALL_CHUNK_PREFIXES.map((prefix) => clearChunkedCollection(uid, prefix)));
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
    async (key) => {
      if (!uid) return;
      await clearChunkedCollection(uid, key);
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
