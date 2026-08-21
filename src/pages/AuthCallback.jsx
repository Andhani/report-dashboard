import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [status, setStatus] = useState("Exchanging code for tokens…");
  const [error, setError] = useState(null);

  useEffect(() => {
    if (loading) return;

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

    exchangeCode(code, user.uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  async function exchangeCode(code, uid) {
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

      await setDoc(
        doc(db, "users", uid, "data", "state"),
        { google_oauth: tokenData },
        { merge: true },
      );

      setStatus("Connected! Redirecting…");
      setTimeout(() => navigate("/settings"), 1500);
    } catch (err) {
      setError(`Network error: ${err.message}`);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="card p-8 w-full max-w-sm text-center">
        <div className="text-4xl mb-4">{error ? "❌" : "🔐"}</div>
        {error ? (
          <>
            <div className="font-semibold text-danger mb-2">
              Authentication Failed
            </div>
            <div className="text-sm text-danger mb-4">{error}</div>
            <button
              onClick={() => navigate("/settings")}
              className="btn-secondary"
            >
              Back to Settings
            </button>
          </>
        ) : (
          <>
            <div className="font-semibold text-gray-900 mb-2">{status}</div>
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
          </>
        )}
      </div>
    </div>
  );
}
