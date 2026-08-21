import { Outlet } from "react-router-dom";
import { Clock } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useCloudData } from "../context/CloudDataContext";

export default function ProtectedRoute() {
  const { user, role, loading, signIn, signOut } = useAuth();
  const { ready } = useCloudData();

  if (loading) {
    return (
      <CenteredCard>
        <Spinner />
        <p className="text-xs text-muted mt-4">Loading…</p>
      </CenteredCard>
    );
  }

  if (!user) {
    return (
      <CenteredCard>
        <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center text-sm font-bold text-white mx-auto mb-5">
          RD
        </div>
        <h1 className="text-base font-semibold text-ink mb-2">
          Report Dashboard
        </h1>
        <p className="text-xs text-muted leading-relaxed mb-6">
          Sign in with your Google account to continue.
        </p>
        <button onClick={signIn} className="btn-primary mx-auto">
          <GoogleIcon />
          Sign in with Google
        </button>
      </CenteredCard>
    );
  }

  if (!role) {
    return (
      <CenteredCard>
        <div className="w-12 h-12 bg-warning/10 rounded-xl flex items-center justify-center mx-auto mb-5">
          <Clock size={20} className="text-warning" strokeWidth={1.75} />
        </div>
        <h1 className="text-base font-semibold text-ink mb-2">
          Access pending
        </h1>
        <p className="text-xs text-muted leading-relaxed mb-1">
          Signed in as <strong className="text-ink">{user.email}</strong>
        </p>
        <p className="text-xs text-muted leading-relaxed mb-6">
          This account hasn't been approved yet. Contact your admin to
          request access.
        </p>
        <button onClick={signOut} className="btn-secondary mx-auto">
          Sign out
        </button>
      </CenteredCard>
    );
  }

  if (!ready) {
    return (
      <CenteredCard>
        <Spinner />
        <p className="text-xs text-muted mt-4">Loading your data…</p>
      </CenteredCard>
    );
  }

  return <Outlet />;
}

function CenteredCard({ children }) {
  return (
    <div className="h-screen flex items-center justify-center bg-bg px-4">
      <div className="card w-full max-w-sm p-10 text-center">{children}</div>
    </div>
  );
}

function Spinner() {
  return (
    <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
  );
}

function GoogleIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
