import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";

function stateDocRef(uid) {
  return doc(db, "users", uid, "data", "state");
}

/**
 * Returns a valid access token, refreshing silently if expired.
 * Returns null if no token stored or refresh fails. Reads/writes the
 * currently signed-in dashboard user's own Firestore document, so each
 * signed-in user has their own separate Google Sheets connection.
 */
export async function getValidToken() {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;

  const snap = await getDoc(stateDocRef(uid));
  const oauth = snap.exists() ? snap.data().google_oauth : null;
  if (!oauth) return null;

  if (Date.now() < oauth.expires_at) return oauth.access_token;

  // Token expired — try refresh
  try {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    const clientSecret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret || !oauth.refresh_token) return null;

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: oauth.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const data = await res.json();
    if (!data.access_token) return null;

    const updated = {
      ...oauth,
      access_token: data.access_token,
      expires_at: Date.now() + (data.expires_in - 60) * 1000,
    };
    await setDoc(stateDocRef(uid), { google_oauth: updated }, { merge: true });
    return data.access_token;
  } catch {
    return null;
  }
}

export async function isConnected() {
  const uid = auth.currentUser?.uid;
  if (!uid) return false;
  const snap = await getDoc(stateDocRef(uid));
  return !!(snap.exists() && snap.data().google_oauth);
}
