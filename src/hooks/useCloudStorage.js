import { useCallback } from "react";
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
