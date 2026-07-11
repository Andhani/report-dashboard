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
        <span className="text-2xs uppercase tracking-wider text-muted">BC Leads</span>
        <span className="text-xs font-semibold text-ink">{monthLabel}</span>
        <span className="text-2xs text-muted">GA4</span>
      </div>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            <td colSpan={2} className="pb-2 w-1/2">
              <div className="text-2xs uppercase tracking-wider text-muted">Traffic Summary</div>
              <div className="text-2xs text-muted mt-0.5">{count} URLs (bottom content)</div>
            </td>
            <td colSpan={2} className="pb-2 w-1/2 pl-6">
              <div className="text-2xs uppercase tracking-wider text-muted">Estimated Leads</div>
            </td>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border">
            <td className="py-1.5 text-muted">Views</td>
            <td className="py-1.5 text-right tabular-nums text-ink">{fmtNum(traffic.views)}</td>
            <td className="py-1.5 pl-6 text-muted">Views-based</td>
            <td className="py-1.5 text-right tabular-nums text-ok">{fmtEst(estimated.views)}</td>
          </tr>
          <tr className="border-b border-border">
            <td className="py-1.5 text-muted">Active Users</td>
            <td className="py-1.5 text-right tabular-nums text-ink">{fmtNum(traffic.users)}</td>
            <td className="py-1.5 pl-6 text-muted">Users-based</td>
            <td className="py-1.5 text-right tabular-nums text-ok">{fmtEst(estimated.users)}</td>
          </tr>
          <tr className="border-b border-border">
            <td className="py-1.5 text-muted">Sessions</td>
            <td className="py-1.5 text-right tabular-nums text-ink">{fmtNum(traffic.sessions)}</td>
            <td className="py-1.5 pl-6 text-muted">Sessions-based</td>
            <td className="py-1.5 text-right tabular-nums text-ok">{fmtEst(estimated.sessions)}</td>
          </tr>
          <tr>
            <td className="py-1.5 text-muted">Avg AET</td>
            <td className="py-1.5 text-right tabular-nums font-medium text-ink">{fmtAET(traffic.aet_seconds)}</td>
            <td className="py-1.5 pl-6"></td>
            <td className="py-1.5"></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Blog Section ─────────────────────────────────────────────────────────────

function BlogSection({ block }) {
  const { monthLabel, creates, updates, grandTotal } = block;
  return (
    <div className="card p-4">
      <div className="flex items-baseline gap-2 mb-4">
        <span className="text-2xs uppercase tracking-wider text-muted">Blog Leads</span>
        <span className="text-xs font-semibold text-ink">{monthLabel}</span>
        <span className="text-2xs text-muted">GA4</span>
      </div>
      <table className="w-full text-xs border-collapse">
        <tbody>
          <tr>
            <td colSpan={2} className="pb-1.5 w-1/2">
              <div className="text-2xs uppercase tracking-wider text-muted">Create ({creates.count})</div>
            </td>
            <td colSpan={2} className="pb-1.5 w-1/2 pl-6">
              <div className="text-2xs uppercase tracking-wider text-muted">Estimated Leads (Create)</div>
            </td>
          </tr>
          <tr className="border-b border-border">
            <td className="py-1.5 text-muted">Views</td>
            <td className="py-1.5 text-right tabular-nums text-ink">{fmtNum(creates.traffic.views)}</td>
            <td className="py-1.5 pl-6 text-muted">Views-based</td>
            <td className="py-1.5 text-right tabular-nums text-ok">{fmtEst(creates.estimated.views)}</td>
          </tr>
          <tr className="border-b border-border">
            <td className="py-1.5 text-muted">Users</td>
            <td className="py-1.5 text-right tabular-nums text-ink">{fmtNum(creates.traffic.users)}</td>
            <td className="py-1.5 pl-6 text-muted">Users-based</td>
            <td className="py-1.5 text-right tabular-nums text-ok">{fmtEst(creates.estimated.users)}</td>
          </tr>
          <tr className="border-b border-border">
            <td className="py-1.5 text-muted">Sessions</td>
            <td className="py-1.5 text-right tabular-nums text-ink">{fmtNum(creates.traffic.sessions)}</td>
            <td className="py-1.5 pl-6 text-muted">Sessions-based</td>
            <td className="py-1.5 text-right tabular-nums text-ok">{fmtEst(creates.estimated.sessions)}</td>
          </tr>
          <tr className="border-b border-border">
            <td className="py-1.5 text-muted">Avg AET</td>
            <td className="py-1.5 text-right tabular-nums font-medium text-ink">{fmtAET(creates.traffic.aet_seconds)}</td>
            <td className="py-1.5 pl-6"></td>
            <td className="py-1.5"></td>
          </tr>
          <tr>
            <td colSpan={2} className="pt-4 pb-1.5 w-1/2">
              <div className="text-2xs uppercase tracking-wider text-muted">Update ({updates.count})</div>
            </td>
            <td colSpan={2} className="pt-4 pb-1.5 w-1/2 pl-6">
              <div className="text-2xs uppercase tracking-wider text-muted">Estimated Leads (Update)</div>
            </td>
          </tr>
          <tr className="border-b border-border">
            <td className="py-1.5 text-muted">Views</td>
            <td className="py-1.5 text-right tabular-nums text-ink">{fmtNum(updates.traffic.views)}</td>
            <td className="py-1.5 pl-6 text-muted">Views-based</td>
            <td className="py-1.5 text-right tabular-nums text-ok">{fmtEst(updates.estimated.views)}</td>
          </tr>
          <tr className="border-b border-border">
            <td className="py-1.5 text-muted">Users</td>
            <td className="py-1.5 text-right tabular-nums text-ink">{fmtNum(updates.traffic.users)}</td>
            <td className="py-1.5 pl-6 text-muted">Users-based</td>
            <td className="py-1.5 text-right tabular-nums text-ok">{fmtEst(updates.estimated.users)}</td>
          </tr>
          <tr className="border-b border-border">
            <td className="py-1.5 text-muted">Sessions</td>
            <td className="py-1.5 text-right tabular-nums text-ink">{fmtNum(updates.traffic.sessions)}</td>
            <td className="py-1.5 pl-6 text-muted">Sessions-based</td>
            <td className="py-1.5 text-right tabular-nums text-ok">{fmtEst(updates.estimated.sessions)}</td>
          </tr>
          <tr>
            <td className="py-1.5 text-muted">Avg AET</td>
            <td className="py-1.5 text-right tabular-nums font-medium text-ink">{fmtAET(updates.traffic.aet_seconds)}</td>
            <td className="py-1.5 pl-6"></td>
            <td className="py-1.5"></td>
          </tr>
          <tr>
            <td colSpan={4} className="pt-3 border-t border-border">
              <div className="text-2xs text-muted">Grand Total: {grandTotal.count} URLs</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Shared Rate Section ──────────────────────────────────────────────────────

function RateSection({ block }) {
  const { rates, siteWide } = block;
  return (
    <div className="card p-4">
      <div className="text-2xs uppercase tracking-wider text-muted mb-3">Lead Rates</div>
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
