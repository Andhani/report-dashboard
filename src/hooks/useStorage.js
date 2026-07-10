import { useState, useCallback, useRef, useEffect } from "react";

const CHUNK_SEP = "::";

/**
 * Like useStorage, but stores each top-level key as a separate localStorage
 * entry to avoid QuotaExceededError on large nested objects (e.g. flow1_data
 * with thousands of parsed URL rows across 6 months).
 *
 * Storage layout:
 *   localStorage[prefix]        → JSON array of entry keys (index)
 *   localStorage[prefix::key]   → JSON value for that entry
 *
 * Reads either the new chunked format (index is an array) or falls back to
 * the old single-key format (index is an object) for zero-migration compat.
 */
export function useChunkedStorage(prefix, defaultValue = {}) {
  const [value, setValueState] = useState(() => {
    try {
      const indexRaw = localStorage.getItem(prefix);
      if (indexRaw !== null) {
        const parsed = JSON.parse(indexRaw);
        if (Array.isArray(parsed)) {
          // New chunked format
          const result = {};
          for (const k of parsed) {
            try {
              const raw = localStorage.getItem(prefix + CHUNK_SEP + k);
              if (raw !== null) result[k] = JSON.parse(raw);
            } catch {}
          }
          return result;
        }
        // Old format: value itself was the stored object
        return parsed;
      }
      return defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const setValue = useCallback(
    (newValue) => {
      setValueState((prev) => {
        const next =
          typeof newValue === "function" ? newValue(prev) : newValue;

        if (next === null || next === undefined) {
          try {
            const indexRaw = localStorage.getItem(prefix);
            if (indexRaw) {
              const keys = JSON.parse(indexRaw);
              if (Array.isArray(keys))
                keys.forEach((k) =>
                  localStorage.removeItem(prefix + CHUNK_SEP + k),
                );
            }
            localStorage.removeItem(prefix);
          } catch {}
          return next;
        }

        const prevKeys = Object.keys(prev || {});
        const nextKeys = Object.keys(next);

        // Write new / changed entries individually
        for (const [k, v] of Object.entries(next)) {
          if ((prev || {})[k] !== v) {
            try {
              localStorage.setItem(prefix + CHUNK_SEP + k, JSON.stringify(v));
            } catch (err) {
              console.error(`useChunkedStorage: could not write "${k}":`, err);
            }
          }
        }

        // Remove deleted entries
        for (const k of prevKeys) {
          if (!Object.prototype.hasOwnProperty.call(next, k)) {
            localStorage.removeItem(prefix + CHUNK_SEP + k);
          }
        }

        // Update index (always array → new format)
        try {
          localStorage.setItem(prefix, JSON.stringify(nextKeys));
        } catch (err) {
          console.error(`useChunkedStorage: could not write index:`, err);
        }

        return next;
      });
    },
    [prefix],
  );

  return [value, setValue];
}

const WRITE_DEBOUNCE_MS = 400;

/**
 * useState that persists to localStorage.
 * Value is JSON-serialized on write and deserialized on read.
 *
 * Writes are debounced: on large datasets (e.g. thousands of imported URL
 * rows), JSON.stringify-ing the whole array on every keystroke is heavy
 * enough to make typing feel sluggish. React state still updates
 * immediately; only the localStorage write is delayed and coalesced.
 */
export function useStorage(key, defaultValue) {
  const [value, setValueState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? JSON.parse(raw) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const timerRef = useRef(null);
  const pendingRef = useRef(undefined);

  const persist = useCallback(
    (next) => {
      try {
        if (next === null || next === undefined) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, JSON.stringify(next));
        }
      } catch (err) {
        console.error("useStorage write error:", err);
      }
    },
    [key],
  );

  const setValue = useCallback(
    (newValue) => {
      setValueState((prev) => {
        const next = typeof newValue === "function" ? newValue(prev) : newValue;
        pendingRef.current = next;
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          persist(pendingRef.current);
          pendingRef.current = undefined;
        }, WRITE_DEBOUNCE_MS);
        return next;
      });
    },
    [persist],
  );

  // Flush any pending write immediately if the component unmounts or the
  // tab closes mid-debounce, so an edit is never silently dropped.
  useEffect(() => {
    function flush() {
      if (pendingRef.current !== undefined) {
        clearTimeout(timerRef.current);
        persist(pendingRef.current);
        pendingRef.current = undefined;
      }
    }
    window.addEventListener("beforeunload", flush);
    return () => {
      flush();
      window.removeEventListener("beforeunload", flush);
    };
  }, [persist]);

  return [value, setValue];
}
