import { useState } from "react";
import { Link } from "react-router-dom";
import { useStorage } from "../hooks/useStorage";
import { getMonthSlots } from "../utils/dateUtils";
import { downloadCSV } from "../utils/exportUtils";
import { extractSpreadsheetId, pushFlow3ToSheets } from "../utils/sheetsApi";
import {
  getLeadsMonth,
  computeBCLeads,
  computeBlogLeads,
  buildBCLeadsCSV,
  buildBlogLeadsCSV,
  fmtNum,
  fmtAET,
  fmtRate,
  fmtEst,
} from "../utils/computeFlow3";

export default function Flow3() {
  const [flow1Data] = useStorage("flow1_data", {});
  const [flow2Data] = useStorage("flow2_data", {});
  const [flow1Window] = useStorage("flow1_window", null);
  const [bcUrls] = useStorage("bc_urls", []);
  const [blogUrls] = useStorage("blog_urls", []);
  const [sheetsUrl] = useStorage("sheets_report_url", "");

  const [activeTab, setActiveTab] = useState("bc");
  const [pushStatus, setPushStatus] = useState(null);
  const [selectedSlotIdx, setSelectedSlotIdx] = useState(null);

  const slots = flow1Window ? getMonthSlots(flow1Window, 6) : [];
  const defaultSlot = getLeadsMonth(slots);
  const currentSlot =
    selectedSlotIdx !== null ? slots[selectedSlotIdx] : defaultSlot;

  const hasFlow1 = Object.keys(flow1Data).length > 0;
  const hasFlow2 = Object.keys(flow2Data).length > 0;

  if (!flow1Window) {
    return (
      <GatingMessage
        icon="⚙️"
        title="Flow 1 window not set"
        desc="Set the Flow 1 rolling window in Settings first."
        to="/settings"
        btnLabel="Go to Settings"
      />
    );
  }

  if (!hasFlow1 && !hasFlow2) {
    return (
      <GatingMessage
        icon="📥"
        title="No data available"
        desc="Complete Flow 1 and Flow 2 data import before computing leads."
        to="/flow1"
        btnLabel="Go to Flow 1"
      />
    );
  }

  const bcBlock = currentSlot
    ? computeBCLeads(bcUrls, flow1Data, flow2Data, currentSlot)
    : null;
  const blogBlock = currentSlot
    ? computeBlogLeads(blogUrls, flow1Data, flow2Data, currentSlot)
    : null;

  function handleDownloadCSV(project) {
    if (!currentSlot) return;
    const block = project === "bc" ? bcBlock : blogBlock;
    const rows =
      project === "bc" ? buildBCLeadsCSV(block) : buildBlogLeadsCSV(block);
    const label = currentSlot.label.replace(" ", "");
    downloadCSV(
      rows,
      `${project === "bc" ? "BC" : "Blog"}_Leads_Summary_${label}.csv`,
    );
  }

  async function handlePushSheets(project) {
    const ssId = extractSpreadsheetId(sheetsUrl);
    if (!ssId) {
      alert("No spreadsheet URL in Settings.");
      return;
    }
    setPushStatus(project + "_pushing");
    try {
      const block = project === "bc" ? bcBlock : blogBlock;
      const rows =
        project === "bc" ? buildBCLeadsCSV(block) : buildBlogLeadsCSV(block);
      await pushFlow3ToSheets(ssId, project, rows);
      setPushStatus(project + "_ok");
      setTimeout(() => setPushStatus(null), 4000);
    } catch (err) {
      setPushStatus(project + "_error:" + err.message);
    }
  }

  const isLastSlot = currentSlot?.key === defaultSlot?.key;

  return (
    <div className="space-y-6">
      {/* Dependency status */}
      <DependencyBanner hasFlow1={hasFlow1} hasFlow2={hasFlow2} />

      {/* Month selector */}
      {slots.length > 0 && (
        <div className="card p-4 flex items-center gap-4">
          <span className="text-sm font-medium text-gray-700">
            Reporting month:
          </span>
          <div className="flex gap-1 flex-wrap">
            {slots.map((s, i) => {
              const isActive = currentSlot?.key === s.key;
              const isDefault = s.key === defaultSlot?.key;
              return (
                <button
                  key={s.key}
                  onClick={() => setSelectedSlotIdx(i)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-accent text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {s.label}
                  {isDefault ? " ★" : ""}
                </button>
              );
            })}
          </div>
          {!isLastSlot && (
            <span className="text-xs text-gray-400">★ = most recent</span>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="inline-flex bg-stone-100 rounded-btn p-1 gap-0.5">
        {["bc", "blog"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-btn text-xs font-medium transition-all ${
              activeTab === tab
                ? "bg-white text-stone-900 shadow-card"
                : "text-stone-500 hover:text-stone-700"
            }`}
          >
            {tab === "bc" ? "BC Leads Summary" : "Blog Leads Summary"}
          </button>
        ))}
      </div>

      {/* Export bar */}
      {currentSlot && (
        <div className="card p-4 flex flex-wrap items-center gap-3">
          <span className="font-semibold text-gray-800 text-sm mr-2">
            Export
          </span>
          {["bc", "blog"].map((proj) => {
            const ps = pushStatus;
            const pushing = ps === proj + "_pushing";
            const ok = ps === proj + "_ok";
            const err = ps?.startsWith(proj + "_error:")
              ? ps.slice(proj.length + 7)
              : null;
            return (
              <div key={proj} className="flex items-center gap-2">
                <button
                  onClick={() => handleDownloadCSV(proj)}
                  className="btn-secondary text-xs"
                >
                  ⬇ {proj === "bc" ? "BC" : "Blog"} CSV
                </button>
                <button
                  onClick={() => handlePushSheets(proj)}
                  disabled={pushing || !sheetsUrl}
                  className={`btn text-xs ${sheetsUrl ? "btn-primary" : "bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed"}`}
                >
                  {pushing ? "…" : ok ? "✓ Pushed!" : "→ Push to Sheets"}
                </button>
                {err && <span className="text-xs text-danger">{err}</span>}
              </div>
            );
          })}
          {!sheetsUrl && (
            <Link to="/settings" className="text-xs text-gray-400 underline">
              Configure Sheets URL
            </Link>
          )}
        </div>
      )}

      {/* Block content */}
      {activeTab === "bc" && currentSlot && bcBlock && (
        <BCLeadsBlock block={bcBlock} />
      )}
      {activeTab === "blog" && currentSlot && blogBlock && (
        <BlogLeadsBlock block={blogBlock} />
      )}
      {!currentSlot && (
        <div className="card p-8 text-center text-gray-400 text-sm">
          No slots defined in the current window.
        </div>
      )}
    </div>
  );
}

// ─── Gating ───────────────────────────────────────────────────────────────────

function GatingMessage({ icon, title, desc, to, btnLabel }) {
  return (
    <div className="max-w-lg mx-auto mt-8 border-2 border-dashed border-stone-200 rounded-card py-12 px-8 flex flex-col items-center text-center">
      <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center text-accent mb-4 text-xl">
        {icon}
      </div>
      <div className="text-sm font-semibold text-stone-800 mb-1">{title}</div>
      <p className="text-xs text-stone-500 mb-4">{desc}</p>
      <Link to={to} className="btn btn-primary">
        {btnLabel}
      </Link>
    </div>
  );
}

function DependencyBanner({ hasFlow1, hasFlow2 }) {
  if (hasFlow1 && hasFlow2) return null;
  return (
    <div className="card p-4 bg-warning/10 border-warning/30">
      <div className="flex items-start gap-3">
        <span className="text-warning text-lg">⚠️</span>
        <div className="text-sm text-ink">
          <strong>Partial data</strong> — some rates will show as 0.
          {!hasFlow1 && (
            <span>
              {" "}
              <Link to="/flow1" className="underline">
                Flow 1 data missing
              </Link>
              .
            </span>
          )}
          {!hasFlow2 && (
            <span>
              {" "}
              <Link to="/flow2" className="underline">
                Flow 2 data missing
              </Link>
              .
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── BC Block ────────────────────────────────────────────────────────────────

function BCLeadsBlock({ block }) {
  const { monthLabel, count, traffic, rates, siteWide, estimated } = block;

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <div className="text-lg font-semibold text-gray-900 mb-1">
          {monthLabel}
        </div>
        <div className="text-xs text-gray-500 mb-5">Data Source = GA4</div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Traffic Summary */}
          <MetricBlock
            title="Traffic Summary"
            subtitle={`Bottom Content: ${count} URLs published`}
          >
            <MetricRow label="Sum of Views" value={fmtNum(traffic.views)} />
            <MetricRow
              label="Sum of Active Users"
              value={fmtNum(traffic.users)}
            />
            <MetricRow
              label="Sum of Sessions"
              value={fmtNum(traffic.sessions)}
            />
            <MetricRow label="Avg of AET" value={fmtAET(traffic.aet_seconds)} />
          </MetricBlock>

          {/* Estimated Leads */}
          <MetricBlock title="Estimated Leads">
            <MetricRow
              label="Views-based"
              value={fmtEst(estimated.views)}
              highlight
            />
            <MetricRow
              label="Users-based"
              value={fmtEst(estimated.users)}
              highlight
            />
            <MetricRow
              label="Sessions-based"
              value={fmtEst(estimated.sessions)}
              highlight
            />
          </MetricBlock>

          {/* Lead Rates */}
          <div className="space-y-4">
            <RateBlock
              title="Lead per Views"
              totalLabel="Total Org Views"
              total={fmtNum(siteWide.totalViews)}
              contact={fmtNum(siteWide.clickContact)}
              rate={fmtRate(rates.leadPerViews)}
            />
            <RateBlock
              title="Lead per Users"
              totalLabel="Total Org Users"
              total={fmtNum(siteWide.totalUsers)}
              contact={fmtNum(siteWide.clickContact)}
              rate={fmtRate(rates.leadPerUsers)}
            />
            <RateBlock
              title="Lead per Sessions"
              totalLabel="Total Org Sessions"
              total={fmtNum(siteWide.totalSessions)}
              contact={fmtNum(siteWide.clickContact)}
              rate={fmtRate(rates.leadPerSessions)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Blog Block ───────────────────────────────────────────────────────────────

function BlogLeadsBlock({ block }) {
  const { monthLabel, creates, updates, grandTotal, rates, siteWide } = block;

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <div className="text-lg font-semibold text-gray-900 mb-1">
          {monthLabel}
        </div>
        <div className="text-xs text-gray-500 mb-5">Data Source = GA4</div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Create + Update blocks */}
          <div className="space-y-5">
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                CREATE CONTENT ({creates.count})
              </div>
              <MetricRow
                label="Sum Views"
                value={fmtNum(creates.traffic.views)}
              />
              <MetricRow
                label="Sum Users"
                value={fmtNum(creates.traffic.users)}
              />
              <MetricRow
                label="Sum Sessions"
                value={fmtNum(creates.traffic.sessions)}
              />
              <MetricRow
                label="Avg AET"
                value={fmtAET(creates.traffic.aet_seconds)}
              />
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                UPDATE CONTENT ({updates.count})
              </div>
              <MetricRow
                label="Sum Views"
                value={fmtNum(updates.traffic.views)}
              />
              <MetricRow
                label="Sum Users"
                value={fmtNum(updates.traffic.users)}
              />
              <MetricRow
                label="Sum Sessions"
                value={fmtNum(updates.traffic.sessions)}
              />
              <MetricRow
                label="Avg AET"
                value={fmtAET(updates.traffic.aet_seconds)}
              />
            </div>
            <div className="border-t border-gray-200 pt-2">
              <div className="text-xs font-semibold text-gray-500 mb-1">
                Grand Total: {grandTotal.count} URLs
              </div>
            </div>
          </div>

          {/* Estimated Leads */}
          <div className="space-y-5">
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Est. Leads (Create)
              </div>
              <MetricRow
                label="Views-based"
                value={fmtEst(creates.estimated.views)}
                highlight
              />
              <MetricRow
                label="Users-based"
                value={fmtEst(creates.estimated.users)}
                highlight
              />
              <MetricRow
                label="Sessions-based"
                value={fmtEst(creates.estimated.sessions)}
                highlight
              />
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Est. Leads (Update)
              </div>
              <MetricRow
                label="Views-based"
                value={fmtEst(updates.estimated.views)}
                highlight
              />
              <MetricRow
                label="Users-based"
                value={fmtEst(updates.estimated.users)}
                highlight
              />
              <MetricRow
                label="Sessions-based"
                value={fmtEst(updates.estimated.sessions)}
                highlight
              />
            </div>
          </div>

          {/* Lead Rates (same as BC — site-wide) */}
          <div className="space-y-4">
            <RateBlock
              title="Lead per Views"
              totalLabel="Total Org Views"
              total={fmtNum(siteWide.totalViews)}
              contact={fmtNum(siteWide.clickContact)}
              rate={fmtRate(rates.leadPerViews)}
            />
            <RateBlock
              title="Lead per Users"
              totalLabel="Total Org Users"
              total={fmtNum(siteWide.totalUsers)}
              contact={fmtNum(siteWide.clickContact)}
              rate={fmtRate(rates.leadPerUsers)}
            />
            <RateBlock
              title="Lead per Sessions"
              totalLabel="Total Org Sessions"
              total={fmtNum(siteWide.totalSessions)}
              contact={fmtNum(siteWide.clickContact)}
              rate={fmtRate(rates.leadPerSessions)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Shared UI blocks ─────────────────────────────────────────────────────────

function MetricBlock({ title, subtitle, children }) {
  return (
    <div>
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
        {title}
      </div>
      {subtitle && <div className="text-xs text-gray-400 mb-2">{subtitle}</div>}
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function MetricRow({ label, value, highlight }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-gray-50">
      <span className="text-sm text-gray-600">{label}</span>
      <span
        className={`text-sm font-medium tabular-nums ${highlight ? "text-success" : "text-gray-900"}`}
      >
        {value}
      </span>
    </div>
  );
}

function RateBlock({ title, totalLabel, total, contact, rate }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <div className="text-xs font-semibold text-gray-600 mb-2">{title}</div>
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-gray-600">
          <span>{totalLabel}</span>
          <span className="tabular-nums">{total}</span>
        </div>
        <div className="flex justify-between text-xs text-gray-600">
          <span>Click_Contact_Agent</span>
          <span className="tabular-nums">{contact}</span>
        </div>
        <div className="flex justify-between text-xs font-semibold text-accent pt-1 border-t border-gray-200">
          <span>Rate</span>
          <span>{rate}</span>
        </div>
      </div>
    </div>
  );
}
