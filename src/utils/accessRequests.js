import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../lib/firebase";

// Requests live in their own collection rather than as "pending" rows in
// allowedUsers. allowedUsers is the authorization source of truth and stays
// admin-only-write in firestore.rules; a requester writes only here, and the
// rules forbid a "role" field outright, so filing a request can never grant
// access. Approval is a separate, admin-only write to allowedUsers.
const COLLECTION = "accessRequests";

// Emails are used verbatim as document ids — never lower-cased — because
// three things have to agree on the exact same string: the security rule
// (which compares the doc id against request.auth.token.email), the
// allowedUsers document an approval writes, and AuthContext's role lookup
// (which reads allowedUsers by the raw Firebase email). Normalising here
// would break the rule match, or worse, silently write an approval to a
// key the role lookup never reads.
function keyFor(email) {
  return (email || "").trim();
}

/** Files (or refreshes) the signed-in user's own request for access. */
export async function submitAccessRequest(user) {
  const email = keyFor(user?.email);
  if (!email) throw new Error("No signed-in email to request access for.");
  await setDoc(doc(db, COLLECTION, email), {
    email,
    // displayName can be null on some providers; Firestore rejects undefined.
    name: user.displayName || "",
    requestedAt: serverTimestamp(),
  });
}

/** Returns the signed-in user's own pending request, or null. */
export async function getMyAccessRequest(email) {
  const key = keyFor(email);
  if (!key) return null;
  const snap = await getDoc(doc(db, COLLECTION, key));
  return snap.exists() ? { email: snap.id, ...snap.data() } : null;
}

/** Admin-only: every outstanding request, oldest first. */
export async function listAccessRequests() {
  const snap = await getDocs(collection(db, COLLECTION));
  return snap.docs
    .map((d) => ({ email: d.id, ...d.data() }))
    .sort((a, b) => {
      const at = a.requestedAt?.toMillis?.() ?? 0;
      const bt = b.requestedAt?.toMillis?.() ?? 0;
      return at - bt;
    });
}

/**
 * Admin-only: grants access, then clears the request. Order matters — the
 * grant is written first so a failure between the two steps leaves the
 * request visible to retry, rather than dropping it with no access given.
 */
export async function approveAccessRequest(email, role, adminEmail) {
  const key = keyFor(email);
  await setDoc(doc(db, "allowedUsers", key), {
    role,
    addedBy: adminEmail,
    addedAt: serverTimestamp(),
  });
  await deleteDoc(doc(db, COLLECTION, key));
}

/** Admin-only: dismisses a request without granting access. */
export async function denyAccessRequest(email) {
  await deleteDoc(doc(db, COLLECTION, keyFor(email)));
}
