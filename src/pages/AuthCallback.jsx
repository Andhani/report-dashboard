import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useCloudData } from "../context/CloudDataContext";

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  // loadError matters here specifically because this route sits outside
  // ProtectedRoute, which is the only other place that renders it. Without
  // reading it, a failed initial fetch leaves `ready` false forever and
  // this page spins with nothing explaining why.
  const { ready, loadError, retryLoad, setStateKey } = useCloudData();
  const [status, setStatus] = useState("Exchanging code for tokens…");
  const [error, setError] = useState(null);
  const [pendingToken, setPendingToken] = useState(null);
  const [slow, setSlow] = useState(false);
  // An authorization code is single-use: a second exchange would fail with
  // invalid_grant, so guard against the effect firing twice.
  const exchangeStartedRef = useRef(false);
  const savedRef = useRef(false);

  // Redeem the authorization code as soon as we know who is signed in.
  // Deliberately NOT gated on the cloud data being `ready`: this route is
  // reached by a full browser redirect, so CloudDataProvider is fetching
  // the account's whole dataset at the same time — thousands of documents
  // for a large URL list. Waiting for that before even calling Google
  // burns the code's short single-use window and looks like a hang. Only
  // the write below waits; the exchange goes out immediately.
  useEffect(() => {
    if (loading || exchangeStartedRef.current) return;

    const code = searchParams.get("code");
    const errorParam = searchParams.get("error");

    if (errorParam) {
      setError(`OAuth error: ${errorParam}`);
      return;
    }

    if (!code) {
      setError("No authorization code received.");
      return;
    }

    if (!user) {
      setError("You must be signed in to the dashboard to connect Google Sheets.");
      return;
    }

    // Auth may have reported "no user" for a moment before restoring the
    // session; that leaves a stale error on screen even though we can now
    // proceed. This effect re-runs when `user` arrives, so clear it.
    setError(null);
    exchangeStartedRef.current = true;
    exchangeCode(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  // A spinner with no end is indistinguishable from a crash. If the wait
  // runs long, say so rather than leaving the page looking frozen.
  useEffect(() => {
    if (ready || loadError) return;
    const timer = setTimeout(() => setSlow(true), 10000);
    return () => clearTimeout(timer);
  }, [ready, loadError]);

  // Persist once the initial fetch has landed. Writing earlier would be
  // clobbered when that fetch completes and replaces local state wholesale
  // — the "had to connect twice" bug this ordering exists to prevent.
  useEffect(() => {
    if (!ready || !pendingToken || savedRef.current) return;
    savedRef.current = true;
    setStateKey("google_oauth", pendingToken, { sync: true });
    setStatus("Connected! Redirecting…");
    const timer = setTimeout(() => navigate("/settings"), 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pendingToken]);

  async function exchangeCode(code) {
    try {
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
      const clientSecret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET;
      const redirectUri =
        import.meta.env.VITE_REDIRECT_URI ||
        "http://localhost:3000/auth/callback";

      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      const data = await res.json();

      if (data.error) {
        setError(
          `Token exchange failed: ${data.error_description || data.error}`,
        );
        return;
      }

      // Store tokens
      const tokenData = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + (data.expires_in - 60) * 1000,
      };

      // Fetch user email (best-effort — don't fail auth if this errors)
      try {
        const userRes = await fetch(
          "https://www.googleapis.com/oauth2/v3/userinfo",
          { headers: { Authorization: `Bearer ${data.access_token}` } },
        );
        const user = await userRes.json();
        if (user.email) tokenData.email = user.email;
      } catch (_) {
        // email is optional
      }

      // Hand off to the effect that waits for `ready` before persisting.
      setPendingToken(tokenData);
      setStatus("Connected — loading your data…");
    } catch (err) {
      setError(`Network error: ${err.message}`);
    }
  }

  const failure = error || loadError;

  return (
    <div className="h-screen flex items-center justify-center bg-bg px-4">
      <div className="card w-full max-w-sm p-10 text-center">
        <div className="text-4xl mb-4">{failure ? "❌" : "🔐"}</div>
        {failure ? (
          <>
            <div className="font-semibold text-danger mb-2">
              {error ? "Authentication Failed" : "Couldn't reach your data"}
            </div>
            <div className="text-xs text-danger mb-2 leading-relaxed break-words">
              {failure}
            </div>
            {loadError && pendingToken && (
              <div className="text-xs text-muted mb-4 leading-relaxed">
                Google approved the connection, but it couldn't be saved.
                Retrying will finish it — nothing needs reconnecting.
              </div>
            )}
            <div className="flex flex-col gap-2 mt-4">
              {loadError && (
                <button onClick={retryLoad} className="btn-primary mx-auto">
                  Try again
                </button>
              )}
              <button
                onClick={() => navigate("/settings")}
                className="btn-secondary mx-auto"
              >
                Back to Settings
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="font-semibold text-ink mb-4">{status}</div>
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
            {slow && (
              <div className="text-xs text-muted mt-5 leading-relaxed">
                Still working. A large URL list can take a while to load on
                this step — leave the tab open.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
