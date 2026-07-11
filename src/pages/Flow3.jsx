import { useState } from "react";
import { Link } from "react-router-dom";
import { useChunkedStorage, useStorage } from "../hooks/useStorage";
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
import { Settings, Database, AlertTriangle } from "lucide-react";
import SheetPushModal from "../components/SheetPushModal";

export default function Flow3() {
  const [flow1Data] = useChunkedStorage("flow1_data", {});
  const [flow2Data] = useChunkedStorage("flow2_data", {});
  const [flow1Window] = useStorage("flow1_window", null);
  const [bcUrls] = useStorage("bc_urls", []);
  const [blogUrls] = useStorage("blog_urls", []);
  const [sheetsUrl] = useStorage("sheets_report_url", "");

  const [activeTab, setActiveTab] = useState("bc");
  const [pushStatus, setPushStatus] = useState(null);
  const [pushModal, setPushModal] = useState(false);
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
        Icon={Settings}
        title="Traffic (Optimized) window not set"
        desc="Set the Traffic (Optimized) rolling window in Settings first."
        to="/settings"
        btnLabel="Go to Settings"
      />
    );
  }

  if (!hasFlow1 && !hasFlow2) {
    return (
      <GatingMessage
        Icon={Database}
        title="No data available"
        desc="Complete Traffic (Optimized) and Traffic Overview data import before computing leads."
        to="/flow1"
        btnLabel="Go to Traffic (Optimized)"
      />
    );
  }

  const bcBlock = currentSlot
    ? computeBCLeads(bcUrls, flow1Data, flow2Data, currentSlot)
    : null;
  const blogBlock = currentSlot
    ? computeBlogLeads(blogUrls, flow1Data, flow2Data, currentSlot)
    : null;

  function handleDownloadCSV() {
    if (!currentSlot) return;
    const rows = [...buildBCLeadsCSV(bcBlock), ...buildBlogLeadsCSV(blogBlock)];
    const label = currentSlot.label.replace(" ", "");
    downloadCSV(rows, `Leads_Summary_${label}.csv`);
  }

  async function handlePushSheets() {
    const ssId = extractSpreadsheetId(sheetsUrl);
    if (!ssId) {
      alert("No spreadsheet URL in Settings.");
      return;
    }
    setPushStatus("pushing");
    try {
      const rows = [
        ...buildBCLeadsCSV(bcBlock),
        ...buildBlogLeadsCSV(blogBlock),
      ];
      await pushFlow3ToSheets(ssId, rows);
      setPushStatus(null);
      setPushModal(true);
    } catch (err) {
      setPushStatus("error:" + err.message);
    }
  }

  const isLastSlot = currentSlot?.key === defaultSlot?.key;

  return (
    <>
      {pushModal && (
        <SheetPushModal
          sheetsUrl={sheetsUrl}
          onClose={() => setPushModal(false)}
        />
      )}
      <div className="space-y-5">
        {/* Dependency status */}
        <DependencyBanner hasFlow1={hasFlow1} hasFlow2={hasFlow2} />

        {/* Month selector */}
        {slots.length > 0 && (
          <div className="card p-3 flex items-center gap-4">
            <span className="text-2xs uppercase tracking-wider text-muted flex-shrink-0">
              Month
            </span>
            <div className="flex gap-1 flex-wrap">
              {slots.map((s, i) => {
                const isActive = currentSlot?.key === s.key;
                const isDefault = s.key === defaultSlot?.key;
                return (
                  <button
                    key={s.key}
                    onClick={() => setSelectedSlotIdx(i)}
                    className={`px-3 py-1 rounded-full text-xs transition-colors ${
                      isActive
                        ? "bg-accent text-white"
                        : "bg-surface-2 text-muted hover:text-ink"
                    }`}
                  >
                    {s.label}
                    {isDefault ? " ★" : ""}
                  </button>
                );
              })}
            </div>
            {!isLastSlot && (
              <span className="text-2xs text-muted">
                ★ = most recent
              </span>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="inline-flex bg-surface-2 rounded-[6px] p-0.5 gap-0.5">
          {["bc", "blog"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1 rounded-[5px] text-xs font-medium transition-all ${
                activeTab === tab
                  ? "bg-surface text-ink shadow-card"
                  : "text-muted hover:text-ink"
              }`}
            >
              {tab === "bc" ? "BC Leads" : "Blog Leads"}
            </button>
          ))}
        </div>

        {/* Export bar */}
        {currentSlot && (
          <div className="card p-3 flex flex-wrap items-center gap-3">
            <button onClick={handleDownloadCSV} className="btn-secondary">
              Export CSV
            </button>
            <button
              onClick={handlePushSheets}
              disabled={pushStatus === "pushing" || !sheetsUrl}
              className={`btn ${sheetsUrl ? "btn-primary" : "btn-secondary opacity-50 cursor-not-allowed"}`}
            >
              {pushStatus === "pushing" ? "Pushing…" : "Push to Sheets"}
            </button>
            {typeof pushStatus === "string" &&
              pushStatus.startsWith("error:") && (
                <span className="text-xs text-danger">
                  {pushStatus.slice(6)}
                </span>
              )}
            {!sheetsUrl && (
              <Link to="/settings" className="text-xs text-muted underline">
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
          <div className="card p-8 text-center text-muted text-xs">
            No slots defined in the current window.
          </div>
        )}
      </div>
    </>
  );
}

// ─── Gating ───────────────────────────────────────────────────────────────────

function GatingMessage({ Icon, title, desc, to, btnLabel }) {
  return (
    <div className="max-w-md mx-auto mt-10 card py-10 px-8 flex flex-col items-center text-center border-dashed">
      <Icon size={24} className="text-muted mb-3" strokeWidth={1.5} />
      <div className="text-xs font-semibold text-ink mb-1">{title}</div>
      <p className="text-xs text-muted mb-4">{desc}</p>
      <Link to={to} className="btn btn-primary">
        {btnLabel}
      </Link>
    </div>
  );
}

function DependencyBanner({ hasFlow1, hasFlow2 }) {
  if (hasFlow1 && hasFlow2) return null;
  return (
    <div className="card p-3 border-warning/40 bg-warning/5">
      <div className="flex items-center gap-2.5">
        <AlertTriangle
          size={14}
          className="text-warning flex-shrink-0"
          strokeWidth={2}
        />
        <div className="text-xs text-ink">
          <strong>Partial data</strong> — some rates will show as 0.
          {!hasFlow1 && (
            <span>
              {" "}
              <Link to="/flow1" className="text-accent underline">
                Traffic (Optimized) data missing
              </Link>
              .
            </span>
          )}
          {!hasFlow2 && (
            <span>
              {" "}
              <Link to="/flow2" className="text-accent underline">
                Traffic Overview data missing
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
    <div className="card p-4">
      <div className="flex items-baseline gap-3 mb-4">
        <div className="text-xs font-semibold text-ink">
          {monthLabel}
        </div>
        <div className="text-2xs text-muted">GA4</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <MetricBlock
          title="Traffic Summary"
          subtitle={`${count} URLs (bottom content)`}
        >
          <MetricRow label="Views" value={fmtNum(traffic.views)} />
          <MetricRow label="Active Users" value={fmtNum(traffic.users)} />
          <MetricRow label="Sessions" value={fmtNum(traffic.sessions)} />
          <MetricRow label="Avg AET" value={fmtAET(traffic.aet_seconds)} />
        </MetricBlock>

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

        <div className="space-y-3">
          <RateBlock
            title="Lead / Views"
            totalLabel="Org Views"
            total={fmtNum(siteWide.totalViews)}
            contact={fmtNum(siteWide.clickContact)}
            rate={fmtRate(rates.leadPerViews)}
          />
          <RateBlock
            title="Lead / Users"
            totalLabel="Org Users"
            total={fmtNum(siteWide.totalUsers)}
            contact={fmtNum(siteWide.clickContact)}
            rate={fmtRate(rates.leadPerUsers)}
          />
          <RateBlock
            title="Lead / Sessions"
            totalLabel="Org Sessions"
            total={fmtNum(siteWide.totalSessions)}
            contact={fmtNum(siteWide.clickContact)}
            rate={fmtRate(rates.leadPerSessions)}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Blog Block ───────────────────────────────────────────────────────────────

function BlogLeadsBlock({ block }) {
  const { monthLabel, creates, updates, grandTotal, rates, siteWide } = block;

  return (
    <div className="card p-4">
      <div className="flex items-baseline gap-3 mb-4">
        <div className="text-xs font-semibold text-ink">
          {monthLabel}
        </div>
        <div className="text-2xs text-muted">GA4</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="space-y-4">
          <div>
            <div className="text-2xs uppercase tracking-wider text-muted mb-1.5">
              Create ({creates.count})
            </div>
            <MetricRow label="Views" value={fmtNum(creates.traffic.views)} />
            <MetricRow label="Users" value={fmtNum(creates.traffic.users)} />
            <MetricRow
              label="Sessions"
              value={fmtNum(creates.traffic.sessions)}
            />
            <MetricRow
              label="Avg AET"
              value={fmtAET(creates.traffic.aet_seconds)}
            />
          </div>
          <div>
            <div className="text-2xs uppercase tracking-wider text-muted mb-1.5">
              Update ({updates.count})
            </div>
            <MetricRow label="Views" value={fmtNum(updates.traffic.views)} />
            <MetricRow label="Users" value={fmtNum(updates.traffic.users)} />
            <MetricRow
              label="Sessions"
              value={fmtNum(updates.traffic.sessions)}
            />
            <MetricRow
              label="Avg AET"
              value={fmtAET(updates.traffic.aet_seconds)}
            />
          </div>
          <div className="border-t border-border pt-2">
            <div className="text-2xs text-muted">
              Grand Total: {grandTotal.count} URLs
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="text-2xs uppercase tracking-wider text-muted mb-1.5">
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
            <div className="text-2xs uppercase tracking-wider text-muted mb-1.5">
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

        <div className="space-y-3">
          <RateBlock
            title="Lead / Views"
            totalLabel="Org Views"
            total={fmtNum(siteWide.totalViews)}
            contact={fmtNum(siteWide.clickContact)}
            rate={fmtRate(rates.leadPerViews)}
          />
          <RateBlock
            title="Lead / Users"
            totalLabel="Org Users"
            total={fmtNum(siteWide.totalUsers)}
            contact={fmtNum(siteWide.clickContact)}
            rate={fmtRate(rates.leadPerUsers)}
          />
          <RateBlock
            title="Lead / Sessions"
            totalLabel="Org Sessions"
            total={fmtNum(siteWide.totalSessions)}
            contact={fmtNum(siteWide.clickContact)}
            rate={fmtRate(rates.leadPerSessions)}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Shared UI blocks ─────────────────────────────────────────────────────────

function MetricBlock({ title, subtitle, children }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wider text-muted mb-1">
        {title}
      </div>
      {subtitle && <div className="text-xs text-muted mb-2">{subtitle}</div>}
      <div className="space-y-0">{children}</div>
    </div>
  );
}

function MetricRow({ label, value, highlight }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <span
        className={`text-xs font-medium tabular-nums ${
          highlight ? "text-ok" : "text-ink"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function RateBlock({ title, totalLabel, total, contact, rate }) {
  return (
    <div className="bg-surface-2 rounded-lg p-3">
      <div className="text-2xs uppercase tracking-wider text-muted mb-2">
        {title}
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-2xs text-muted">
          <span>{totalLabel}</span>
          <span className="tabular-nums">{total}</span>
        </div>
        <div className="flex justify-between text-2xs text-muted">
          <span>Click_Contact</span>
          <span className="tabular-nums">{contact}</span>
        </div>
        <div className="flex justify-between text-xs font-semibold text-accent pt-1 border-t border-border">
          <span>Rate</span>
          <span>{rate}</span>
        </div>
      </div>
    </div>
  );
}
