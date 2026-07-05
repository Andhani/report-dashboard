import { useState, useCallback, useRef, useEffect } from "react";

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
