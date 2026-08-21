import { createContext, useContext, useEffect, useState } from "react";
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

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setRole(null);
        setLoading(false);
        return;
      }
      setUser(firebaseUser);
      try {
        const allowedSnap = await getDoc(
          doc(db, "allowedUsers", firebaseUser.email),
        );
        setRole(allowedSnap.exists() ? allowedSnap.data().role || "user" : null);
      } catch (err) {
        console.error("AuthContext: allowedUsers lookup failed:", err);
        setRole(null);
      }
      setLoading(false);
    });
  }, []);

  function signIn() {
    return signInWithPopup(auth, googleProvider);
  }

  function signOut() {
    return firebaseSignOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, role, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
