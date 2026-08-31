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
import {
  approveAccessRequest,
  denyAccessRequest,
  listAccessRequests,
} from "../utils/accessRequests";

// requestedAt is a serverTimestamp, so it reads back null for the moment
// between a local write and the server round-trip.
function formatRequestedAt(ts) {
  const date = ts?.toDate?.();
  if (!date) return "just now";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Admin() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [error, setError] = useState(null);
  const [busyEmail, setBusyEmail] = useState(null);

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

  async function loadRequests() {
    try {
      setRequests(await listAccessRequests());
    } catch (err) {
      console.error("Admin: loading access requests failed:", err);
    }
  }

  useEffect(() => {
    loadUsers();
    loadRequests();
  }, []);

  async function handleApprove(email, role) {
    setError(null);
    setBusyEmail(email);
    try {
      await approveAccessRequest(email, role, user.email);
      await Promise.all([loadUsers(), loadRequests()]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyEmail(null);
    }
  }

  async function handleDeny(email) {
    if (!confirm(`Deny the access request from ${email}?`)) return;
    setError(null);
    setBusyEmail(email);
    try {
      await denyAccessRequest(email);
      await loadRequests();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyEmail(null);
    }
  }

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
      {requests.length > 0 && (
        <div className="card p-5 space-y-4 border-warning/40">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold text-ink">Access Requests</h2>
            <span className="text-2xs bg-warning/15 text-warning rounded-full px-2 py-0.5 font-medium">
              {requests.length}
            </span>
          </div>
          <p className="text-xs text-muted">
            These people signed in and asked for access. Approving adds them
            to the list below.
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="text-left text-muted font-medium pb-2 pr-4">
                  Email
                </th>
                <th className="text-left text-muted font-medium pb-2 pr-4">
                  Requested
                </th>
                <th className="text-left text-muted font-medium pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {requests.map((r) => (
                <tr key={r.email}>
                  <td className="py-2 pr-4 text-ink">
                    {r.email}
                    {r.name && (
                      <span className="text-muted"> · {r.name}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-muted">
                    {formatRequestedAt(r.requestedAt)}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => handleApprove(r.email, "user")}
                        disabled={busyEmail === r.email}
                        className="btn-primary text-2xs disabled:opacity-60"
                      >
                        {busyEmail === r.email ? "…" : "Approve"}
                      </button>
                      <button
                        onClick={() => handleApprove(r.email, "admin")}
                        disabled={busyEmail === r.email}
                        className="btn-secondary text-2xs disabled:opacity-60"
                      >
                        As admin
                      </button>
                      <button
                        onClick={() => handleDeny(r.email)}
                        disabled={busyEmail === r.email}
                        className="btn-ghost text-danger text-2xs disabled:opacity-60"
                      >
                        Deny
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
