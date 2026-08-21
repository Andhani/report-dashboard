import { useEffect } from "react";
import { useStorage } from "../hooks/useStorage";
import { useCloudStorage } from "../hooks/useCloudStorage";
import { useCloudData } from "../context/CloudDataContext";
import { useDataContext } from "../context/DataContext";
import { getMonthSlots } from "../utils/dateUtils";
import { getValidToken } from "../utils/googleAuth";

export default function Settings() {
  // Google Sheets OAuth token stays in localStorage — it's inherently
  // per-browser and unrelated to the per-user report data below.
  const [oauthToken, setOauthToken] = useStorage("google_oauth", null);
  const [flow1Window, setFlow1Window] = useCloudStorage("flow1_window", null);
  const [flow2Window, setFlow2Window] = useCloudStorage("flow2_window", null);
  const [sheetsUrl, setSheetsUrl] = useCloudStorage("sheets_report_url", "");
  const [, setBcUrls] = useCloudStorage("bc_urls", [], { sync: true });
  const [, setBlogUrls] = useCloudStorage("blog_urls", [], { sync: true });
  const { setFlow1Data, setFlow2Data } = useDataContext();
  const { clearAll } = useCloudData();

  // Fetch email from Google userinfo if token exists but email not yet stored
  useEffect(() => {
    if (!oauthToken || oauthToken.email) return;
    getValidToken().then((token) => {
      if (!token) return;
      fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((user) => {
          if (user.email) {
            setOauthToken((prev) => ({ ...prev, email: user.email }));
          }
        })
        .catch(() => {});
    });
  }, [oauthToken?.access_token]);

  const monthOptions = buildMonthOptions();

  function handleSheetsUrl(e) {
    e.preventDefault();
    setSheetsUrl(sheetsUrl.trim());
    alert("Spreadsheet URL saved.");
  }

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const redirectUri =
    import.meta.env.VITE_REDIRECT_URI || "http://localhost:3000/auth/callback";

  function handleOAuthConnect() {
    if (!clientId) {
      alert("VITE_GOOGLE_CLIENT_ID is not set in .env");
      return;
    }
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope:
        "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email",
      access_type: "offline",
      prompt: "consent",
    });
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  function handleDisconnect() {
    if (confirm("Disconnect Google account?")) {
      localStorage.removeItem("google_oauth");
      window.location.reload();
    }
  }

  const clearConfirmMessages = {
    flow1: "Clear Traffic (Optimized) data? This cannot be undone.",
    flow2: "Clear Traffic Overview data? This cannot be undone.",
    urls: "Clear the URL List (BC and Blog)? This cannot be undone.",
    all: "Clear everything? This deletes all report data across every tab and all settings. This cannot be undone.",
  };

  async function handleClearData(target) {
    if (!confirm(clearConfirmMessages[target])) return;

    if (target === "flow1") {
      setFlow1Data({});
    } else if (target === "flow2") {
      setFlow2Data({});
    } else if (target === "urls") {
      setBcUrls([]);
      setBlogUrls([]);
    } else if (target === "all") {
      await clearAll();
      localStorage.clear();
      window.location.reload();
    }
  }

  const tokenExpiry = oauthToken?.expires_at
    ? new Date(oauthToken.expires_at).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const tokenExpired = oauthToken?.expires_at
    ? oauthToken.expires_at < Date.now()
    : false;

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Google Sheets OAuth */}
      <div className="card p-5 space-y-4">
        <h2 className="text-xs font-semibold text-ink">
          Google Sheets Connection
        </h2>
        {oauthToken ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs">
              <span
                className={`w-2 h-2 rounded-full inline-block flex-shrink-0 ${
                  tokenExpired ? "bg-pending" : "bg-ok"
                }`}
              />
              <span className={tokenExpired ? "text-warning" : "text-ok"}>
                {tokenExpired
                  ? "Token expired — will auto-refresh on next push"
                  : "Connected"}
              </span>
            </div>
            {oauthToken.email && (
              <div className="text-xs text-muted">
                Signed in as <strong className="text-ink">{oauthToken.email}</strong>
              </div>
            )}
            {tokenExpiry && (
              <div className="text-2xs text-muted">
                Token {tokenExpired ? "expired" : "expires"}: {tokenExpiry}
                {oauthToken.refresh_token && (
                  <span className="ml-2 text-ok">· refresh token stored</span>
                )}
              </div>
            )}
            <button
              onClick={handleDisconnect}
              className="btn-secondary text-danger border-danger/30 hover:bg-danger/5"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              Connect your Google account to push results directly to a Google
              Spreadsheet.
            </p>
            {!clientId && (
              <div className="p-3 bg-warning/8 border border-warning/30 rounded-lg text-xs text-ink">
                <strong>VITE_GOOGLE_CLIENT_ID</strong> not set — add it to your{" "}
                <code className="font-mono text-xs bg-surface-2 px-1 py-0.5 rounded">.env</code> file first.
              </div>
            )}
            <button
              onClick={handleOAuthConnect}
              disabled={!clientId}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
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
              Connect with Google
            </button>
          </div>
        )}
      </div>

      {/* Report Spreadsheet URL */}
      <div className="card p-5 space-y-4">
        <h2 className="text-xs font-semibold text-ink">
          Report Spreadsheet URL
        </h2>
        <p className="text-sm text-muted">
          Paste the URL of the Google Spreadsheet where reports will be written.
        </p>
        <form onSubmit={handleSheetsUrl} className="flex gap-3">
          <input
            type="url"
            className="input flex-1"
            placeholder="https://docs.google.com/spreadsheets/d/..."
            value={sheetsUrl}
            onChange={(e) => setSheetsUrl(e.target.value)}
          />
          <button type="submit" className="btn-primary">
            Save
          </button>
        </form>
        {sheetsUrl && (
          <div className="text-xs text-ok flex items-center gap-1">
            <span className="dot-ok">●</span> Saved
          </div>
        )}
      </div>

      {/* Report Sheet Tabs */}
      <div className="card p-5 space-y-4">
        <h2 className="text-xs font-semibold text-ink">
          Report Sheet Tabs
        </h2>
        <p className="text-sm text-muted">
          Each report writes to a specific tab. Tabs are created automatically if
          they don't exist yet.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "38%" }} />
              <col style={{ width: "31%" }} />
              <col style={{ width: "31%" }} />
            </colgroup>
            <thead>
              <tr>
                <th className="text-left text-muted font-medium pb-2.5 pr-4">Report</th>
                <th className="text-left text-muted font-medium pb-2.5 pr-4">BC tab</th>
                <th className="text-left text-muted font-medium pb-2.5">Blog tab</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="py-2 pr-4 text-muted align-middle">Traffic (Optimized)</td>
                <td className="py-2 pr-4 align-middle">
                  <code className="bg-surface-2 text-ink px-2 py-0.5 rounded text-xs font-mono border border-border">
                    BC Traffic (Optimized)
                  </code>
                </td>
                <td className="py-2 align-middle">
                  <code className="bg-surface-2 text-ink px-2 py-0.5 rounded text-xs font-mono border border-border">
                    Blog Traffic (Optimized)
                  </code>
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-muted align-middle">Leads Summary</td>
                <td className="py-2 pr-4 align-middle">
                  <code className="bg-surface-2 text-ink px-2 py-0.5 rounded text-xs font-mono border border-border">
                    BC Leads Summary
                  </code>
                </td>
                <td className="py-2 align-middle">
                  <code className="bg-surface-2 text-ink px-2 py-0.5 rounded text-xs font-mono border border-border">
                    Blog Leads Summary
                  </code>
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-muted align-middle">Traffic Overview</td>
                <td className="py-2 align-middle" colSpan={2}>
                  <code className="bg-surface-2 text-ink px-2 py-0.5 rounded text-xs font-mono border border-border">
                    Traffic Overview (BC and Blog)
                  </code>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Traffic (Optimized) Rolling Window */}
      <div className="card p-5 space-y-4">
        <div>
          <h2 className="text-xs font-semibold text-ink">
            Traffic (Optimized) — Rolling Window
          </h2>
          <p className="text-xs text-muted mt-1">
            Set the first month of the 6-month window for Traffic Import.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="label mb-0 whitespace-nowrap">Start Month</label>
          <select
            className="input w-48"
            value={flow1Window || ""}
            onChange={(e) => setFlow1Window(e.target.value || null)}
          >
            <option value="">— Select —</option>
            {monthOptions.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        {flow1Window && <SlotPreview window={flow1Window} count={6} />}
      </div>

      {/* Traffic Overview Rolling Window */}
      <div className="card p-5 space-y-4">
        <div>
          <h2 className="text-xs font-semibold text-ink">
            Traffic Overview — Rolling Window
          </h2>
          <p className="text-xs text-muted mt-1">
            Set the first month of the 6-month window for Traffic Overview.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="label mb-0 whitespace-nowrap">Start Month</label>
          <select
            className="input w-48"
            value={flow2Window || ""}
            onChange={(e) => setFlow2Window(e.target.value || null)}
          >
            <option value="">— Select —</option>
            {monthOptions.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        {flow2Window && <SlotPreview window={flow2Window} count={6} />}
      </div>

      {/* Data Management */}
      <div className="card p-5 space-y-4">
        <div>
          <h2 className="text-xs font-semibold text-ink">
            Data Management
          </h2>
          <p className="text-xs text-muted mt-1">
            Clear imported data from localStorage. This cannot be undone.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {[
            { key: "flow1", label: "Clear Traffic (Optimized) data" },
            { key: "flow2", label: "Clear Traffic Overview data" },
            { key: "urls", label: "Clear URL List" },
            { key: "all", label: "Clear everything", danger: true },
          ].map(({ key, label, danger }) => (
            <button
              key={key}
              onClick={() => handleClearData(key)}
              className={`btn-secondary ${
                danger ? "text-danger border-danger/30 hover:bg-danger/5" : ""
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SlotPreview({ window, count }) {
  const slots = getMonthSlots(window, count);
  return (
    <div className="flex flex-wrap gap-1.5">
      {slots.map((s, i) => (
        <span
          key={s.key}
          className={`px-2.5 py-1 rounded-full text-xs ${
            i === 0
              ? "bg-accent-subtle text-accent border border-accent/20"
              : "bg-surface-2 text-muted border border-border"
          }`}
        >
          {s.label}
        </span>
      ))}
    </div>
  );
}

function buildMonthOptions() {
  const options = [];
  const now = new Date();
  for (let i = 0; i <= 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
    options.push({ key, label });
  }
  return options;
}
