import { useCallback, useMemo } from "react";
import { useCloudData } from "../context/CloudDataContext";
import { docsToRows, shardsToDocs } from "../utils/rowShards";

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
 * Array-oriented storage for row lists too large for one Firestore document
 * (bc_urls/blog_urls run to thousands of rows).
 *
 * Rows are packed into a handful of shard documents rather than one document
 * per row. Both layouts stay under the 1 MiB document limit, but per-row
 * documents spend Firestore quota in proportion to the row count: importing
 * 7,714 rows cost 7,714 writes, clearing them 7,714 deletes, loading them
 * 7,714 reads, against a free-plan allowance of 20,000 of each per day. With
 * shards the same list is about sixteen documents, so every one of those
 * operations costs sixteen.
 *
 * Reading tolerates either layout, so an account still holding per-row
 * documents loads normally; its next save writes shards, and the leftovers
 * are deleted because they are absent from what gets stored.
 */
export function useCloudArrayStorage(key, defaultValue = []) {
  const { chunked, setChunkedValue } = useCloudData();
  const docsById = chunked[key] ?? {};
  // Only consulted while reading the old per-row layout; shards carry their
  // own order, so nothing writes this any more.
  const [legacyOrder, setLegacyOrder] = useCloudStorage(`${key}_order`, null, {
    sync: true,
  });

  const { array, onLegacyLayout } = useMemo(() => {
    if (Object.keys(docsById).length === 0) {
      return { array: defaultValue, onLegacyLayout: false };
    }
    const { rows, migrated } = docsToRows(docsById, legacyOrder);
    return { array: rows, onLegacyLayout: !migrated };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docsById, legacyOrder]);

  // Returns a promise that resolves once every shard has landed. Callers
  // saving a large list must await it before showing success or allowing a
  // reload — a part-finished save leaves the list short by whatever hadn't
  // committed.
  const setArray = useCallback(
    (newValueOrFn, { onProgress } = {}) => {
      const next =
        typeof newValueOrFn === "function" ? newValueOrFn(array) : newValueOrFn;

      // Any per-row documents still present are absent from this map, so the
      // storage layer deletes them — the old layout is cleaned up by the
      // first save that follows it.
      const nextDocs = shardsToDocs(next);

      // compareByValue: a shard is rebuilt on every save, so by reference
      // they all look changed. Comparing contents means editing one row
      // rewrites one shard instead of all of them.
      const written = setChunkedValue(key, nextDocs, {}, {
        onProgress,
        compareByValue: true,
      });

      // The order document belongs to the per-row layout. Clear it once,
      // while migrating away, and never write it again.
      const orderCleared =
        onLegacyLayout && legacyOrder != null
          ? setLegacyOrder(null)
          : Promise.resolve();

      // Resolves to a result rather than rejecting: row edits and additions
      // call this without awaiting, and a rejected promise nobody is
      // holding becomes an unhandled rejection. Callers that care about
      // the outcome read `ok`.
      return Promise.all([written, orderCleared]).then(
        () => ({ ok: true, error: null }),
        (error) => ({ ok: false, error }),
      );
    },
    [array, key, legacyOrder, onLegacyLayout, setChunkedValue, setLegacyOrder],
  );

  return [array, setArray];
}
