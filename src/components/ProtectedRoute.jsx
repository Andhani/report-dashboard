import { Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useCloudData } from "../context/CloudDataContext";

export default function ProtectedRoute() {
  const { user, role, loading, signIn, signOut } = useAuth();
  const { ready } = useCloudData();

  if (loading) {
    return <CenteredCard>Loading…</CenteredCard>;
  }

  if (!user) {
    return (
      <CenteredCard>
        <div className="w-8 h-8 bg-accent rounded-md flex items-center justify-center text-xs font-bold text-white mx-auto mb-2">
          RD
        </div>
        <h1 className="text-sm font-semibold text-ink mb-1">Report Dashboard</h1>
        <p className="text-xs text-muted mb-4">
          Sign in with your Google account to continue.
        </p>
        <button onClick={signIn} className="btn-primary mx-auto">
          Sign in with Google
        </button>
      </CenteredCard>
    );
  }

  if (!role) {
    return (
      <CenteredCard>
        <h1 className="text-sm font-semibold text-ink mb-1">Access pending</h1>
        <p className="text-xs text-muted mb-1">
          Signed in as <strong className="text-ink">{user.email}</strong>
        </p>
        <p className="text-xs text-muted mb-4">
          This account hasn't been approved yet. Contact your admin to request
          access.
        </p>
        <button onClick={signOut} className="btn-secondary mx-auto">
          Sign out
        </button>
      </CenteredCard>
    );
  }

  if (!ready) {
    return <CenteredCard>Loading your data…</CenteredCard>;
  }

  return <Outlet />;
}

function CenteredCard({ children }) {
  return (
    <div className="h-screen flex items-center justify-center bg-bg">
      <div className="card p-8 max-w-sm text-center space-y-1">{children}</div>
    </div>
  );
}
