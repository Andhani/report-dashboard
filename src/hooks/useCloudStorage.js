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
    (newValue, opts) => setChunkedValue(prefix, newValue, defaultValue, opts),
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

  // Returns a promise that resolves once every row document AND the order
  // document have landed. Callers saving a large list must await it before
  // showing success or allowing a reload — thousands of rows commit across
  // many round trips, and a reload part-way through leaves the list short
  // by however many batches hadn't finished.
  const setArray = useCallback(
    (newValueOrFn, { onProgress } = {}) => {
      const next =
        typeof newValueOrFn === "function" ? newValueOrFn(array) : newValueOrFn;
      const nextObj = {};
      const nextOrder = [];
      for (const row of next) {
        nextObj[row.id] = row;
        nextOrder.push(row.id);
      }
      // compareByValue: rows are small, and an import rebuilds every one of
      // them, so without a contents check an unchanged re-import rewrites
      // the entire list.
      const rowsWritten = setChunkedValue(key, nextObj, {}, {
        onProgress,
        compareByValue: true,
      });

      // The order document holds every row id, so for a large list it is
      // hundreds of kilobytes. Editing a cell changes one row's contents
      // and leaves the order untouched, yet this used to rewrite the whole
      // thing on every keystroke — far more traffic than the single small
      // row write beside it. Only write when the order really changed:
      // a row added, removed, or moved.
      const orderChanged =
        !Array.isArray(order) ||
        order.length !== nextOrder.length ||
        nextOrder.some((id, i) => order[i] !== id);
      const orderWritten = orderChanged
        ? setOrder(nextOrder)
        : Promise.resolve();
      // Resolves to a result rather than rejecting: row edits and additions
      // call this without awaiting, and a rejected promise nobody is
      // holding becomes an unhandled rejection. Callers that care about
      // the outcome read `ok`.
      return Promise.all([rowsWritten, orderWritten]).then(
        () => ({ ok: true, error: null }),
        (error) => ({ ok: false, error }),
      );
    },
    [array, key, order, setChunkedValue, setOrder],
  );

  return [array, setArray];
}
