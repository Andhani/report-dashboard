import { useState } from "react";
import { Link } from "react-router-dom";
import { useStorage } from "../hooks/useStorage";
import { useDataContext } from "../context/DataContext";
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

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function toDateStr(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function Flow3() {
  const { flow1Data, flow2Data } = useDataContext();
  const [flow1Window] = useStorage("flow1_window", null);
  const [bcUrls] = useStorage("bc_urls", []);
  const [blogUrls] = useStorage("blog_urls", []);
  const [sheetsUrl] = useStorage("sheets_report_url", "");

  const [pushStatus, setPushStatus] = useState(null);
  const [pushModal, setPushModal] = useState(false);
  const [selectedSlotIdx, setSelectedSlotIdx] = useState(null);
  const [dateRange, setDateRange] = useState({ startDay: null, endDay: null });

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

  function handleSlotSelect(i) {
    setSelectedSlotIdx(i);
    setDateRange({ startDay: null, endDay: null });
  }

  const lastDay = currentSlot
    ? daysInMonth(currentSlot.year, currentSlot.month)
    : 31;
  const minDate = currentSlot
    ? toDateStr(currentSlot.year, currentSlot.month, 1)
    : "";
  const maxDate = currentSlot
    ? toDateStr(currentSlot.year, currentSlot.month, lastDay)
    : "";
  const startDateVal =
    currentSlot && dateRange.startDay
      ? toDateStr(currentSlot.year, currentSlot.month, dateRange.startDay)
      : "";
  const endDateVal =
    currentSlot && dateRange.endDay
      ? toDateStr(currentSlot.year, currentSlot.month, dateRange.endDay)
      : "";
  const hasDateFilter = dateRange.startDay !== null || dateRange.endDay !== null;

  const bcBlock = currentSlot
    ? computeBCLeads(bcUrls, flow1Data, flow2Data, currentSlot, dateRange)
    : null;
  const blogBlock = currentSlot
    ? computeBlogLeads(blogUrls, flow1Data, flow2Data, currentSlot, dateRange)
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
                    onClick={() => handleSlotSelect(i)}
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
              <span className="text-2xs text-muted">★ = most recent</span>
            )}
          </div>
        )}

        {/* Date range filter */}
        {currentSlot && (
          <div className="card p-3 flex flex-wrap items-center gap-4">
            <span className="text-2xs uppercase tracking-wider text-muted flex-shrink-0">
              Date Range
            </span>
            <label className="flex items-center gap-2 text-xs text-muted">
              From
              <input
                type="date"
                min={minDate}
                max={maxDate}
                value={startDateVal}
                onChange={(e) => {
                  const day = e.target.value
                    ? +e.target.value.split("-")[2]
                    : null;
                  setDateRange((r) => ({ ...r, startDay: day }));
                }}
                className="rounded border border-border bg-surface-2 px-2 py-0.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-muted">
              To
              <input
                type="date"
                min={minDate}
                max={maxDate}
                value={endDateVal}
                onChange={(e) => {
                  const day = e.target.value
                    ? +e.target.value.split("-")[2]
                    : null;
                  setDateRange((r) => ({ ...r, endDay: day }));
                }}
                className="rounded border border-border bg-surface-2 px-2 py-0.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>
            {hasDateFilter ? (
              <button
                onClick={() => setDateRange({ startDay: null, endDay: null })}
                className="text-2xs text-muted hover:text-ink underline"
              >
                Clear
              </button>
            ) : (
              <span className="text-2xs text-muted">
                Full month (no filter)
              </span>
            )}
          </div>
        )}

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

        {/* Merged output: BC → Blog → shared rates */}
        {currentSlot && bcBlock && <BCSection block={bcBlock} />}
        {currentSlot && blogBlock && <BlogSection block={blogBlock} />}
        {currentSlot && (bcBlock || blogBlock) && (
          <RateSection block={bcBlock ?? blogBlock} />
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

// ─── BC Section ───────────────────────────────────────────────────────────────

function BCSection({ block }) {
  const { monthLabel, count, traffic, estimated } = block;
  return (
    <div className="card p-4">
      <div className="flex items-baseline gap-2 mb-4">
        <span className="text-2xs uppercase tracking-wider text-muted">
          BC Leads
        </span>
        <span className="text-xs font-semibold text-ink">{monthLabel}</span>
        <span className="text-2xs text-muted">GA4</span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 text-xs">
        {/* Headers */}
        <div className="pb-2">
          <div className="text-2xs uppercase tracking-wider text-muted">
            Traffic Summary
          </div>
          <div className="text-2xs text-muted mt-0.5">
            {count} URLs (bottom content)
          </div>
        </div>
        <div className="pb-2">
          <div className="text-2xs uppercase tracking-wider text-muted">
            Estimated Leads
          </div>
        </div>
        {/* Views */}
        <SplitRow label="Views" value={fmtNum(traffic.views)} />
        <SplitRow
          label="Views-based"
          value={fmtEst(estimated.views)}
          highlight
        />
        {/* Users */}
        <SplitRow label="Active Users" value={fmtNum(traffic.users)} />
        <SplitRow
          label="Users-based"
          value={fmtEst(estimated.users)}
          highlight
        />
        {/* Sessions */}
        <SplitRow label="Sessions" value={fmtNum(traffic.sessions)} />
        <SplitRow
          label="Sessions-based"
          value={fmtEst(estimated.sessions)}
          highlight
        />
        {/* Avg AET — no right counterpart */}
        <SplitRow label="Avg AET" value={fmtAET(traffic.aet_seconds)} last />
        <div className="py-1.5" />
      </div>
    </div>
  );
}

// ─── Blog Section ─────────────────────────────────────────────────────────────

function BlogSection({ block }) {
  const { monthLabel, creates, updates, grandTotal } = block;
  return (
    <div className="card p-4">
      <div className="flex items-baseline gap-2 mb-4">
        <span className="text-2xs uppercase tracking-wider text-muted">
          Blog Leads
        </span>
        <span className="text-xs font-semibold text-ink">{monthLabel}</span>
        <span className="text-2xs text-muted">GA4</span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 text-xs">
        {/* Create headers */}
        <div className="pb-1.5">
          <div className="text-2xs uppercase tracking-wider text-muted">
            Create ({creates.count})
          </div>
        </div>
        <div className="pb-1.5">
          <div className="text-2xs uppercase tracking-wider text-muted">
            Estimated Leads (Create)
          </div>
        </div>
        {/* Create rows */}
        <SplitRow label="Views" value={fmtNum(creates.traffic.views)} />
        <SplitRow
          label="Views-based"
          value={fmtEst(creates.estimated.views)}
          highlight
        />
        <SplitRow label="Users" value={fmtNum(creates.traffic.users)} />
        <SplitRow
          label="Users-based"
          value={fmtEst(creates.estimated.users)}
          highlight
        />
        <SplitRow label="Sessions" value={fmtNum(creates.traffic.sessions)} />
        <SplitRow
          label="Sessions-based"
          value={fmtEst(creates.estimated.sessions)}
          highlight
        />
        <SplitRow
          label="Avg AET"
          value={fmtAET(creates.traffic.aet_seconds)}
          last
        />
        <div className="py-1.5" />
        {/* Update headers */}
        <div className="pt-4 pb-1.5">
          <div className="text-2xs uppercase tracking-wider text-muted">
            Update ({updates.count})
          </div>
        </div>
        <div className="pt-4 pb-1.5">
          <div className="text-2xs uppercase tracking-wider text-muted">
            Estimated Leads (Update)
          </div>
        </div>
        {/* Update rows */}
        <SplitRow label="Views" value={fmtNum(updates.traffic.views)} />
        <SplitRow
          label="Views-based"
          value={fmtEst(updates.estimated.views)}
          highlight
        />
        <SplitRow label="Users" value={fmtNum(updates.traffic.users)} />
        <SplitRow
          label="Users-based"
          value={fmtEst(updates.estimated.users)}
          highlight
        />
        <SplitRow label="Sessions" value={fmtNum(updates.traffic.sessions)} />
        <SplitRow
          label="Sessions-based"
          value={fmtEst(updates.estimated.sessions)}
          highlight
        />
        <SplitRow
          label="Avg AET"
          value={fmtAET(updates.traffic.aet_seconds)}
          last
        />
        <div className="py-1.5" />
        {/* Grand total */}
        <div className="col-span-2 pt-3 border-t border-border">
          <div className="text-2xs text-muted">
            Grand Total: {grandTotal.count} URLs
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Shared UI helpers ────────────────────────────────────────────────────────

function SplitRow({ label, value, highlight, last }) {
  return (
    <div
      className={`flex items-center justify-between py-1.5 ${last ? "" : "border-b border-border"}`}
    >
      <span className="text-muted">{label}</span>
      <span
        className={`tabular-nums font-medium ${highlight ? "text-ok" : "text-ink"}`}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Shared Rate Section ──────────────────────────────────────────────────────

function RateSection({ block }) {
  const { rates, siteWide } = block;
  return (
    <div className="card p-4">
      <div className="text-2xs uppercase tracking-wider text-muted mb-3">
        Lead Rates
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
  );
}

// ─── Shared UI blocks ─────────────────────────────────────────────────────────

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
