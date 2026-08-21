import { useEffect, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";

export default function Admin() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [error, setError] = useState(null);

  async function loadUsers() {
    setLoading(true);
    const snap = await getDocs(collection(db, "allowedUsers"));
    setUsers(
      snap.docs
        .map((d) => ({ email: d.id, ...d.data() }))
        .sort((a, b) => a.email.localeCompare(b.email)),
    );
    setLoading(false);
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleAdd(e) {
    e.preventDefault();
    setError(null);
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    try {
      await setDoc(doc(db, "allowedUsers", email), {
        role: newRole,
        addedBy: user.email,
        addedAt: serverTimestamp(),
      });
      setNewEmail("");
      setNewRole("user");
      await loadUsers();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRemove(email) {
    if (email === user.email) {
      alert("You can't remove your own access.");
      return;
    }
    if (!confirm(`Remove access for ${email}?`)) return;
    await deleteDoc(doc(db, "allowedUsers", email));
    await loadUsers();
  }

  async function handleToggleRole(target) {
    const nextRole = target.role === "admin" ? "user" : "admin";
    if (target.email === user.email && nextRole !== "admin") {
      alert("You can't demote yourself.");
      return;
    }
    await setDoc(doc(db, "allowedUsers", target.email), { role: nextRole }, { merge: true });
    await loadUsers();
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="card p-5 space-y-4">
        <h2 className="text-xs font-semibold text-ink">Add User</h2>
        <p className="text-xs text-muted">
          Only emails added here can sign in to this dashboard.
        </p>
        <form onSubmit={handleAdd} className="flex gap-3">
          <input
            type="email"
            className="input flex-1"
            placeholder="name@example.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <select
            className="input w-32"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" className="btn-primary">
            Add
          </button>
        </form>
        {error && <div className="text-xs text-danger">{error}</div>}
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="text-xs font-semibold text-ink">Approved Users</h2>
        {loading ? (
          <p className="text-xs text-muted">Loading…</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="text-left text-muted font-medium pb-2 pr-4">
                  Email
                </th>
                <th className="text-left text-muted font-medium pb-2 pr-4">
                  Role
                </th>
                <th className="text-left text-muted font-medium pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.email}>
                  <td className="py-2 pr-4 text-ink">{u.email}</td>
                  <td className="py-2 pr-4">
                    <button
                      onClick={() => handleToggleRole(u)}
                      className="btn-secondary text-2xs"
                    >
                      {u.role}
                    </button>
                  </td>
                  <td className="py-2">
                    <button
                      onClick={() => handleRemove(u.email)}
                      className="btn-ghost text-danger text-2xs"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
