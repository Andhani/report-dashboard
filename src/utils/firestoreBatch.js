import { writeBatch } from "firebase/firestore";
import { db } from "../lib/firebase";

// Firestore caps a batched write at 500 operations. That count is the limit
// people remember, but it is not the only one — and on the delete side it is
// almost never the one that bites.
export const FIRESTORE_BATCH_LIMIT = 500;

// A commit is also capped by the *size of the transaction*, and a delete is
// not free there: the transaction carries the document being removed, not
// merely the few bytes of its path. Clearing a tab therefore blows the size
// ceiling long before the 500-operation one — Flow 1/2 store one uploaded
// export per document (up to ~400 KiB per part) and URL lists shard at the
// same size, so a single 500-delete batch can ask Firestore to move well
// over a hundred megabytes and come back as
//   invalid-argument: Transaction too big. Decrease transaction size.
// with nothing deleted at all. Batches are packed by bytes as well as count,
// comfortably under the ~10 MiB ceiling so index entries and request
// overhead still fit.
export const MAX_COMMIT_BYTES = 4 * 1024 * 1024;

// Anything near the 1 MiB per-document limit is committed on its own, so a
// document Firestore rejects can only ever fail itself — a batch is
// all-or-nothing, and one oversized export used to take the valid documents
// batched beside it down with it.
export const ISOLATE_DOC_BYTES = 900 * 1024;

// Used only when a caller cannot tell us how big a document is. Deliberately
// pessimistic: over-estimating costs an extra round trip, under-estimating
// costs the whole commit.
export const UNKNOWN_DOC_BYTES = 64 * 1024;

/**
 * Approximate stored size of a value, in bytes. JSON length is not
 * Firestore's own accounting (it ignores field-name and index overhead), but
 * it tracks the real figure closely enough to pack batches with, and
 * `commitGroup` covers the remaining error by splitting on rejection.
 */
export function estimateBytes(value) {
  if (value === undefined || value === null) return 4;
  try {
    return JSON.stringify(value)?.length ?? UNKNOWN_DOC_BYTES;
  } catch {
    return UNKNOWN_DOC_BYTES;
  }
}

/** True for the backend's "this commit moves too much data" rejection. */
export function isTransactionTooBig(err) {
  const message = String(err?.message || "");
  return (
    /transaction too big/i.test(message) ||
    /decrease transaction size/i.test(message) ||
    (err?.code === "invalid-argument" &&
      /(payload|request).{0,20}(size|too large)|maximum.{0,20}size/i.test(
        message,
      ))
  );
}

/**
 * Groups `ops` — `{ bytes, apply(batch) }` — into commit-sized batches.
 * Exported for the callers that need to report progress per batch.
 */
export function packOps(ops, maxBytes = MAX_COMMIT_BYTES) {
  const groups = [];
  let current = [];
  let bytes = 0;

  const flush = () => {
    if (current.length > 0) groups.push(current);
    current = [];
    bytes = 0;
  };

  for (const op of ops) {
    const isolate = op.bytes >= ISOLATE_DOC_BYTES;
    if (
      current.length > 0 &&
      (isolate ||
        current.length >= FIRESTORE_BATCH_LIMIT ||
        bytes + op.bytes > maxBytes)
    ) {
      flush();
    }
    current.push(op);
    bytes += op.bytes;
    // Close immediately too, so the next operation cannot join it.
    if (isolate) flush();
  }
  flush();
  return groups;
}

/**
 * Commits one packed group, halving and retrying if Firestore still calls
 * the transaction too big.
 *
 * The byte budget above is an estimate made from JSON length; Firestore's
 * own accounting includes overhead this side cannot see, so a group can
 * still come back rejected. Splitting turns that into a slower delete rather
 * than a failed one, and the halves are committed in sequence so a retry can
 * never widen the burst that was already too much.
 */
export async function commitGroup(ops) {
  if (ops.length === 0) return;
  const batch = writeBatch(db);
  for (const op of ops) op.apply(batch);
  try {
    await batch.commit();
  } catch (err) {
    if (ops.length < 2 || !isTransactionTooBig(err)) throw err;
    const mid = Math.ceil(ops.length / 2);
    await commitGroup(ops.slice(0, mid));
    await commitGroup(ops.slice(mid));
  }
}

/**
 * Commits every op, reporting operations landed as each batch returns.
 * `onProgress(done, total)`.
 */
export async function commitOps(ops, { onProgress, maxBytes } = {}) {
  const groups = packOps(ops, maxBytes);
  const total = ops.length;
  let done = 0;
  onProgress?.(0, total);
  await Promise.all(
    groups.map((group) =>
      commitGroup(group).then(() => {
        done += group.length;
        onProgress?.(done, total);
      }),
    ),
  );
}
