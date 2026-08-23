import { useCallback, useMemo } from "react";
import { useCloudData } from "../context/CloudDataContext";

/**
 * Drop-in, Firestore-backed replacement for useStorage — same
 * [value, setValue] signature (including the { sync } option), but reads
 * from and writes to the current user's cloud document instead of
 * localStorage. Must be used inside <CloudDataProvider>.
 */
export function useCloudStorage(key, defaultValue, opts = {}) {
  const { stateDoc, setStateKey } = useCloudData();
  const value = Object.prototype.hasOwnProperty.call(stateDoc, key)
    ? stateDoc[key]
    : defaultValue;

  const setValue = useCallback(
    (newValue) => setStateKey(key, newValue, { ...opts, defaultValue }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, setStateKey, defaultValue, opts.sync],
  );

  return [value, setValue];
}

/**
 * Drop-in, Firestore-backed replacement for useChunkedStorage — same
 * [value, setValue, { missingKeys, writeError }] signature.
 */
export function useChunkedCloudStorage(prefix, defaultValue = {}) {
  const { chunked, setChunkedValue, writeErrors } = useCloudData();
  const value = chunked[prefix] ?? defaultValue;

  const setValue = useCallback(
    (newValue) => setChunkedValue(prefix, newValue, defaultValue),
    [prefix, setChunkedValue, defaultValue],
  );

  return [
    value,
    setValue,
    { missingKeys: [], writeError: writeErrors[prefix] || null },
  ];
}

/**
 * Array-oriented storage for row lists that can grow past Firestore's 1 MiB
 * single-document limit (e.g. bc_urls/blog_urls with thousands of rows).
 * Each row is chunked into its own document, keyed by the row's own `id`,
 * the same way flow1Data/flow2Data already chunk large parsed datasets —
 * so one giant list can't blow a document's size budget the way it did
 * when the whole array lived in a single document/field. A small separate
 * document holds just the row order (an array of ids stays tiny even at
 * thousands of rows), since the chunked collection itself has no ordering.
 */
export function useCloudArrayStorage(key, defaultValue = []) {
  const { chunked, setChunkedValue } = useCloudData();
  const rowsObj = chunked[key] ?? {};
  const [order, setOrder] = useCloudStorage(`${key}_order`, null, {
    sync: true,
  });

  const array = useMemo(() => {
    const rowIds = Object.keys(rowsObj);
    if (rowIds.length === 0) return defaultValue;
    if (!Array.isArray(order)) return Object.values(rowsObj);
    const seen = new Set();
    const result = [];
    for (const id of order) {
      if (Object.prototype.hasOwnProperty.call(rowsObj, id)) {
        result.push(rowsObj[id]);
        seen.add(id);
      }
    }
    for (const [id, row] of Object.entries(rowsObj)) {
      if (!seen.has(id)) result.push(row);
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsObj, order]);

  const setArray = useCallback(
    (newValueOrFn) => {
      const next =
        typeof newValueOrFn === "function" ? newValueOrFn(array) : newValueOrFn;
      const nextObj = {};
      const nextOrder = [];
      for (const row of next) {
        nextObj[row.id] = row;
        nextOrder.push(row.id);
      }
      setChunkedValue(key, nextObj);
      setOrder(nextOrder);
    },
    [array, key, setChunkedValue, setOrder],
  );

  return [array, setArray];
}
