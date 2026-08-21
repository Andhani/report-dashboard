import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "./AuthContext";
import {
  CHUNKED_PREFIXES,
  clearChunkedCollection,
  persistLegacyMigration,
  readLegacyLocalStorage,
} from "../utils/migrateLocalStorage";

const WRITE_DEBOUNCE_MS = 400;

const CloudDataContext = createContext(null);

function emptyChunked() {
  return Object.fromEntries(CHUNKED_PREFIXES.map((p) => [p, {}]));
}

/**
 * Firestore-backed replacement for the localStorage data layer
 * (useStorage/useChunkedStorage). Loads a signed-in, approved user's report
 * data once (gating ProtectedRoute's <Outlet/> via `ready`), then serves
 * useCloudStorage/useChunkedCloudStorage from this single in-memory copy so
 * sibling hook instances on the same page don't each issue their own reads.
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
      const stateSnap = await getDoc(doc(db, "users", uid, "data", "state"));
      const chunkResults = {};
      for (const prefix of CHUNKED_PREFIXES) {
        const snap = await getDocs(collection(db, "users", uid, prefix));
        const obj = {};
        snap.forEach((d) => {
          obj[d.id] = d.data().value;
        });
        chunkResults[prefix] = obj;
      }
      if (cancelled) return;

      let finalState = stateSnap.exists() ? stateSnap.data() : null;
      let finalChunks = chunkResults;

      if (finalState === null) {
        const legacy = readLegacyLocalStorage();
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
  const timersRef = useRef({});
  const pendingRef = useRef({});

  const persistStateKey = useCallback(
    (key, next) => {
      if (!uid) return;
      setDoc(doc(db, "users", uid, "data", "state"), { [key]: next ?? null }, {
        merge: true,
      }).catch((err) => console.error(`CloudData: write "${key}" failed:`, err));
    },
    [uid],
  );

  const setStateKey = useCallback(
    (key, newValue, { sync = false, defaultValue } = {}) => {
      setStateDocState((prev) => {
        const base = Object.prototype.hasOwnProperty.call(prev, key)
          ? prev[key]
          : defaultValue;
        const next = typeof newValue === "function" ? newValue(base) : newValue;
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
        return { ...prev, [key]: next };
      });
    },
    [persistStateKey],
  );

  useEffect(() => {
    function flush() {
      Object.entries(pendingRef.current).forEach(([key, next]) => {
        clearTimeout(timersRef.current[key]);
        persistStateKey(key, next);
      });
      pendingRef.current = {};
    }
    window.addEventListener("beforeunload", flush);
    return () => {
      flush();
      window.removeEventListener("beforeunload", flush);
    };
  }, [persistStateKey]);

  // ── Chunked collections (mirrors useChunkedStorage) ────────────────────
  const setChunkedValue = useCallback(
    (prefix, newValue, defaultValue = {}) => {
      setChunkedState((prevAll) => {
        const prev = prevAll[prefix] ?? defaultValue;
        const next = typeof newValue === "function" ? newValue(prev) : newValue;
        writeErrorsRef.current[prefix] = null;

        if (!uid) return prevAll;

        if (next === null || next === undefined) {
          Object.keys(prev).forEach((k) => {
            deleteDoc(doc(db, "users", uid, prefix, k)).catch(() => {});
          });
          return { ...prevAll, [prefix]: {} };
        }

        for (const [k, v] of Object.entries(next)) {
          if (prev[k] !== v) {
            setDoc(doc(db, "users", uid, prefix, k), { value: v }).catch((err) => {
              writeErrorsRef.current[prefix] =
                "Cloud sync failed for some data — kept in memory but may not survive a refresh.";
              console.error(`CloudData: chunk write "${prefix}/${k}" failed:`, err);
              bump((n) => n + 1);
            });
          }
        }
        for (const k of Object.keys(prev)) {
          if (!Object.prototype.hasOwnProperty.call(next, k)) {
            deleteDoc(doc(db, "users", uid, prefix, k)).catch(() => {});
          }
        }

        return { ...prevAll, [prefix]: next };
      });
    },
    [uid],
  );

  const clearAll = useCallback(async () => {
    if (!uid) return;
    await setDoc(doc(db, "users", uid, "data", "state"), {});
    await Promise.all(CHUNKED_PREFIXES.map((prefix) => clearChunkedCollection(uid, prefix)));
    setStateDocState({});
    setChunkedState(emptyChunked());
  }, [uid]);

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
