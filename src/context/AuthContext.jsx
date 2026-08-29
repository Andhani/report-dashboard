import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "../lib/firebase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  const lookupRole = useCallback(async (email) => {
    try {
      const allowedSnap = await getDoc(doc(db, "allowedUsers", email));
      return allowedSnap.exists() ? allowedSnap.data().role || "user" : null;
    } catch (err) {
      console.error("AuthContext: allowedUsers lookup failed:", err);
      return null;
    }
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setRole(null);
        setLoading(false);
        return;
      }
      setUser(firebaseUser);
      setRole(await lookupRole(firebaseUser.email));
      setLoading(false);
    });
  }, [lookupRole]);

  /**
   * Re-checks the allow-list for the signed-in user. Roles are otherwise
   * only read when auth state changes, so someone waiting on the access
   * screen would have to sign out and back in to notice an approval that
   * just landed. Returns the freshly read role.
   */
  const refreshRole = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) return null;
    const next = await lookupRole(current.email);
    setRole(next);
    return next;
  }, [lookupRole]);

  function signIn() {
    return signInWithPopup(auth, googleProvider);
  }

  function signOut() {
    return firebaseSignOut(auth);
  }

  return (
    <AuthContext.Provider
      value={{ user, role, loading, signIn, signOut, refreshRole }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
