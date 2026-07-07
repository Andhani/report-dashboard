import { useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { useStorage } from "../hooks/useStorage";
import { usePagination } from "../hooks/usePagination";
import {
  getMonthSlots,
  formatMonthKey,
  secondsToHmmss,
  formatCTR,
} from "../utils/dateUtils";
import {
  parseFlow1File,
  parseFlow1Workbook,
  getDataKey,
  formatDetectionLabel,
} from "../utils/parseFlow1";
import {
  computeFlow1Output,
  buildCSVData,
  buildSheetsValues,
} from "../utils/computeFlow1";
import { downloadCSV, readFileAsArrayBuffer } from "../utils/exportUtils";
import {
  pushFlow1ToSheets,
  extractSpreadsheetId,
  buildWorkbookFromSheet,
} from "../utils/sheetsApi";
import SheetLinkImport from "../components/SheetLinkImport";
import SheetPushModal from "../components/SheetPushModal";
import PaginationControls from "../components/PaginationControls";
import {
  Upload,
  Settings,
  Link2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  MinusCircle,
  X,
} from "lucide-react";

const PERIOD_LABEL = (slots) =>
  slots.length
    ? `${slots[0].label.replace(" ", "")}–${slots[slots.length - 1].label.replace(" ", "")}`
    : "";

export default function Flow1() {
  const [flow1Data, setFlow1Data] = useStorage("flow1_data", {});
  const [flow1Window] = useStorage("flow1_window", null);
  const [bcUrls] = useStorage("bc_urls", []);
  const [blogUrls] = useStorage("blog_urls", []);
  const [sheetsUrl] = useStorage("sheets_report_url", "");

  const [log, setLog] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [previewTab, setPreviewTab] = useState("bc");
  const [pushStatus, setPushStatus] = useState({});
  const [pushModal, setPushModal] = useState(false);
  const fileRef = useRef();

  const slots = flow1Window ? getMonthSlots(flow1Window, 6) : [];
  const slotKeys = new Set(slots.map((s) => s.key));

  // ─── File processing ────────────────────────────────────────────────────────

  async function processFiles(files) {
    setProcessing(true);
    const newEntries = {};
    const newLog = [];

    for (const file of Array.from(files)) {
      if (!file.name.match(/\.(xlsx)$/i)) {
        newLog.push({
          file: file.name,
          status: "skip",
          message: "Not an .xlsx file — skipped",
        });
        continue;
      }
      try {
        const buf = await readFileAsArrayBuffer(file);
        const result = await parseFlow1File(buf);

        if (!result) {
          newLog.push({
            file: file.name,
            status: "error",
            message:
              "Could not detect file type — check sheet names (Filters/Pages or Free-form 1)",
          });
          continue;
        }

        const key = getDataKey(result);
        if (!key) {
          newLog.push({
            file: file.name,
            status: "warn",
            message: `Detected as ${result.type} but segment/project unknown — skipped`,
          });
          continue;
        }

        const monthKey = formatMonthKey(result.month.year, result.month.month);
        const inWindow = slotKeys.has(monthKey);

        newEntries[key] = { rows: result.rows, file: file.name };
        newLog.push({
          file: file.name,
          status: inWindow ? "ok" : "warn",
          message:
            formatDetectionLabel(result) +
            (inWindow ? "" : " ⚠ outside current window"),
          key,
        });
      } catch (err) {
        newLog.push({ file: file.name, status: "error", message: err.message });
      }
    }

    setFlow1Data((prev) => ({ ...prev, ...newEntries }));
    setLog((prev) => [...newLog, ...prev]);
    setProcessing(false);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) processFiles(files);
  }

  // ─── Import from a Google Sheet link ────────────────────────────────────────

  async function importFromSheetLink(url) {
    let wb = await buildWorkbookFromSheet(url, ["filters", "pages"]);
    let result = wb.SheetNames.length ? parseFlow1Workbook(wb) : null;
    if (!result) {
      wb = await buildWorkbookFromSheet(url, ["freeform"]);
      result = wb.SheetNames.length ? parseFlow1Workbook(wb) : null;
    }
    if (!result) {
      throw new Error(
        "Could not find a GSC (Filters + Pages) or GA4 (Free-form) tab in that sheet.",
      );
    }

    const key = getDataKey(result);
    if (!key)
      throw new Error(
        `Detected as ${result.type} but segment/project could not be determined.`,
      );

    const monthKey = formatMonthKey(result.month.year, result.month.month);
    const inWindow = slotKeys.has(monthKey);

    setFlow1Data((prev) => ({
      ...prev,
      [key]: { rows: result.rows, file: "Google Sheet" },
    }));
    setLog((prev) => [
      {
        file: "Google Sheet",
        status: inWindow ? "ok" : "warn",
        message:
          formatDetectionLabel(result) +
          (inWindow ? "" : " ⚠ outside current window"),
        key,
      },
      ...prev,
    ]);
  }

  function clearSlot(key) {
    setFlow1Data((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  // ─── Export ─────────────────────────────────────────────────────────────────

  function handleDownloadCSV(project) {
    const urlList = project === "bc" ? bcUrls : blogUrls;
    const output = computeFlow1Output(project, urlList, flow1Data, slots);
    const csv = buildCSVData(project, output, slots);
    const period = PERIOD_LABEL(slots);
    downloadCSV(
      csv,
      `${project === "bc" ? "BC" : "Blog"}_Traffic_${period}.csv`,
    );
  }

  async function handlePushSheets(project) {
    const ssId = extractSpreadsheetId(sheetsUrl);
    if (!ssId) {
      alert("No spreadsheet URL configured — add it in Settings.");
      return;
    }
    setPushStatus((p) => ({ ...p, [project]: "pushing" }));
    try {
      const urlList = project === "bc" ? bcUrls : blogUrls;
      const output = computeFlow1Output(project, urlList, flow1Data, slots);
      const values = buildSheetsValues(output);
      await pushFlow1ToSheets(ssId, project, values);
      setPushStatus((p) => ({ ...p, [project]: null }));
      setPushModal(true);
    } catch (err) {
      setPushStatus((p) => ({ ...p, [project]: "error:" + err.message }));
    }
  }

  // ─── Slot state helpers ──────────────────────────────────────────────────────

  function slotStatus(row, slotKey) {
    if (row === "bc_gsc") {
      const d = !!flow1Data[`bc_gsc_dijual_${slotKey}`];
      const s = !!flow1Data[`bc_gsc_disewa_${slotKey}`];
      if (d && s) return "ok";
      if (d || s) return "pending";
      return "empty";
    }
    return flow1Data[`${row}_${slotKey}`] ? "ok" : "empty";
  }

  function slotTooltip(row, slotKey) {
    if (row === "bc_gsc") {
      const d = flow1Data[`bc_gsc_dijual_${slotKey}`];
      const s = flow1Data[`bc_gsc_disewa_${slotKey}`];
      const parts = [];
      if (d) parts.push(`✓ dijual (${d.file})`);
      if (s) parts.push(`✓ disewa (${s.file})`);
      if (!d) parts.push("✗ dijual missing");
      if (!s) parts.push("✗ disewa missing");
      return parts.join("\n");
    }
    const entry = flow1Data[`${row}_${slotKey}`];
    return entry ? `✓ ${entry.file}` : "Empty";
  }

  const anyData = Object.keys(flow1Data).length > 0;
  const canExport = slots.length > 0;

  // ─── Render ──────────────────────────────────────────────────────────────────

  if (!flow1Window) {
    return (
      <GatingState
        Icon={Settings}
        title="Rolling window not set"
        desc="Set the Traffic (Optimized) start month in Settings before uploading files."
        to="/settings"
        btnLabel="Go to Settings"
      />
    );
  }

  if (bcUrls.length === 0 && blogUrls.length === 0) {
    return (
      <GatingState
        Icon={Link2}
        title="URL lists are empty"
        desc="Add BC and Blog URL lists before running VLOOKUP."
        to="/urls"
        btnLabel="Go to URL Lists"
      />
    );
  }

  return (
    <>
      {pushModal && (
        <SheetPushModal sheetsUrl={sheetsUrl} onClose={() => setPushModal(false)} />
      )}
    <div className="space-y-5">
      {/* What-to-upload guide */}
      <UploadGuide />

      {/* Drop zone */}
      <DropZone
        dragging={dragging}
        processing={processing}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onClick={() => fileRef.current.click()}
      />
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx"
        multiple
        className="hidden"
        onChange={(e) => {
          processFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Or import straight from a Google Sheet link */}
      <SheetLinkImport
        onImport={importFromSheetLink}
        label="Or import from a Sheet link instead"
        hint="Tabs must be named like the original export (Filters + Pages, or Free-form)."
      />

      {/* Detection log */}
      {log.length > 0 && <DetectionLog log={log} onClear={() => setLog([])} />}

      {/* Slot grid */}
      <SlotGrid
        slots={slots}
        slotStatus={slotStatus}
        slotTooltip={slotTooltip}
        flow1Data={flow1Data}
        onClearSlot={clearSlot}
      />

      {/* Preview + Export */}
      {anyData && canExport && (
        <PreviewSection
          key={previewTab}
          previewTab={previewTab}
          setPreviewTab={setPreviewTab}
          slots={slots}
          flow1Data={flow1Data}
          bcUrls={bcUrls}
          blogUrls={blogUrls}
          onDownloadCSV={handleDownloadCSV}
          onPushSheets={handlePushSheets}
          pushStatus={pushStatus}
          sheetsUrl={sheetsUrl}
        />
      )}
    </div>
    </>
  );
}

// ─── Gating state ─────────────────────────────────────────────────────────────

function GatingState({ Icon, title, desc, to, btnLabel }) {
  return (
    <div className="max-w-md mx-auto mt-10 card py-10 px-8 flex flex-col items-center text-center border-dashed">
      <Icon size={24} className="text-muted mb-3" strokeWidth={1.5} />
      <div className="text-sm font-semibold text-ink mb-1">{title}</div>
      <p className="text-xs text-muted mb-4">{desc}</p>
      <Link to={to} className="btn-primary">
        {btnLabel}
      </Link>
    </div>
  );
}

// ─── Upload Guide ─────────────────────────────────────────────────────────────

function UploadGuide() {
  const rows = [
    {
      label: "BC — GSC export",
      detail: ".xlsx with Filters + Pages tabs, one file per segment (dijual, disewa)",
    },
    {
      label: "BC — GA4 export",
      detail: ".xlsx with a Free-form tab, covers both BC segments in one file",
    },
    {
      label: "Blog — GSC export",
      detail: ".xlsx with Filters + Pages tabs, Page filter set to /articles-all/",
    },
    {
      label: "Blog — GA4 export",
      detail: ".xlsx with a Free-form tab for the blog project",
    },
  ];
  return (
    <div className="card p-4">
      <div className="text-sm font-semibold text-ink mb-2">
        What to upload — 4 file kinds per month
      </div>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start gap-2 text-sm text-ink">
            <span className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 bg-muted" />
            <span>
              <strong>{r.label}:</strong>{" "}
              <span className="text-muted">{r.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted mt-2">
        Drop all files at once — each one is auto-detected and slotted into the
        correct month/segment below.
      </p>
    </div>
  );
}

// ─── Drop Zone ────────────────────────────────────────────────────────────────

function DropZone({
  dragging,
  processing,
  onDrop,
  onDragOver,
  onDragLeave,
  onClick,
}) {
  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={onClick}
      className={`border-2 border-dashed rounded-card transition-colors cursor-pointer select-none py-10 px-8 flex flex-col items-center text-center ${
        dragging
          ? "border-accent bg-accent-subtle"
          : "border-border hover:border-muted hover:bg-surface-2/40"
      }`}
    >
      {processing ? (
        <>
          <div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin mb-3" />
          <div className="text-xs font-medium text-muted">
            Processing files…
          </div>
        </>
      ) : (
        <>
          <Upload size={22} className="text-muted mb-3" strokeWidth={1.5} />
          <div className="text-sm font-semibold text-ink mb-1">
            {dragging ? "Drop files here" : "Drag & drop .xlsx files"}
          </div>
          <div className="text-xs text-muted mb-4">
            GSC exports (Pages + Filters sheets) · GA4 exports (Free-form 1 sheet)
          </div>
          <div className="btn-secondary pointer-events-none">Browse files</div>
        </>
      )}
    </div>
  );
}

// ─── Detection Log ────────────────────────────────────────────────────────────

const LOG_ICONS = {
  ok:    <CheckCircle2 size={13} className="text-ok flex-shrink-0 mt-0.5" strokeWidth={2} />,
  warn:  <AlertTriangle size={13} className="text-pending flex-shrink-0 mt-0.5" strokeWidth={2} />,
  error: <XCircle size={13} className="text-danger flex-shrink-0 mt-0.5" strokeWidth={2} />,
  skip:  <MinusCircle size={13} className="text-empty flex-shrink-0 mt-0.5" strokeWidth={2} />,
};

function DetectionLog({ log, onClear }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink">Detection Log</h3>
        <button
          onClick={onClear}
          className="text-xs text-muted hover:text-ink"
        >
          Clear
        </button>
      </div>
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {log.map((entry, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            {LOG_ICONS[entry.status]}
            <span
              className="font-mono text-muted truncate max-w-[200px]"
              title={entry.file}
            >
              {entry.file}
            </span>
            <span
              className={
                entry.status === "error"
                  ? "text-danger"
                  : entry.status === "warn"
                    ? "text-warning"
                    : "text-ink"
              }
            >
              {entry.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Slot Grid ────────────────────────────────────────────────────────────────

const SLOT_ROWS = [
  { id: "bc_gsc", label: "BC GSC", note: "dijual + disewa" },
  { id: "bc_ga4", label: "BC GA4", note: "" },
  { id: "blog_gsc", label: "Blog GSC", note: "" },
  { id: "blog_ga4", label: "Blog GA4", note: "" },
];

function SlotGrid({ slots, slotStatus, slotTooltip, flow1Data, onClearSlot }) {
  const filled = slots.filter(
    (s) => slotStatus("bc_gsc", s.key) === "ok",
  ).length;
  const total = slots.length;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-heading text-base font-semibold text-ink">Slot Status</h2>
        <div className="flex items-center gap-4 text-xs font-mono text-muted">
          <span><span className="dot-ok">●</span> filled</span>
          <span><span className="dot-pending">●</span> partial</span>
          <span><span className="dot-empty">●</span> empty</span>
          <span className="text-muted">{filled}/{total}</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left font-mono text-xs uppercase tracking-wider text-muted pb-2 pr-4 w-32">
                Source
              </th>
              {slots.map((s) => (
                <th
                  key={s.key}
                  className="text-center font-mono text-xs uppercase tracking-wider text-muted pb-2 px-3 min-w-[76px]"
                >
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {SLOT_ROWS.map((row, ri) => (
              <tr key={row.id} className={ri % 2 === 1 ? "bg-surface-2/40" : ""}>
                <td className="py-2.5 pr-4">
                  <div className="font-medium text-ink text-sm">
                    {row.label}
                  </div>
                  {row.note && (
                    <div className="text-xs text-muted font-mono">{row.note}</div>
                  )}
                </td>
                {slots.map((s) => {
                  const st = slotStatus(row.id, s.key);
                  return (
                    <td key={s.key} className="py-2.5 px-3 text-center">
                      <SlotCell
                        status={st}
                        tooltip={slotTooltip(row.id, s.key)}
                        rowId={row.id}
                        slotKey={s.key}
                        flow1Data={flow1Data}
                        onClear={onClearSlot}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SlotCell({ status, tooltip, rowId, slotKey, flow1Data, onClear }) {
  const [hover, setHover] = useState(false);

  function handleClear(e) {
    e.stopPropagation();
    if (rowId === "bc_gsc") {
      if (confirm("Clear BC GSC data for this month?")) {
        onClear(`bc_gsc_dijual_${slotKey}`);
        onClear(`bc_gsc_disewa_${slotKey}`);
      }
    } else {
      onClear(`${rowId}_${slotKey}`);
    }
  }

  return (
    <div
      className="inline-flex items-center gap-1"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={tooltip}
    >
      <span className={`dot-${status} font-mono text-base`}>●</span>
      {hover && status !== "empty" && (
        <button
          onClick={handleClear}
          className="text-muted hover:text-danger transition-colors"
          title="Clear this slot"
        >
          <X size={11} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

// ─── Preview + Export ─────────────────────────────────────────────────────────

function PreviewSection({
  previewTab,
  setPreviewTab,
  slots,
  flow1Data,
  bcUrls,
  blogUrls,
  onDownloadCSV,
  onPushSheets,
  pushStatus,
  sheetsUrl,
}) {
  const urlList = previewTab === "bc" ? bcUrls : blogUrls;
  const output = computeFlow1Output(previewTab, urlList, flow1Data, slots);
  const matchCount = output.filter(
    (r) =>
      r.metrics.clicks.some((v) => v > 0) || r.metrics.views.some((v) => v > 0),
  ).length;
  const pagination = usePagination(output, 100);

  return (
    <div className="space-y-4">
      {/* Export bar */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        {(() => {
          const proj = previewTab;
          const ps = pushStatus[proj];
          return (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onDownloadCSV(proj)}
                className="btn-secondary"
              >
                Export {proj === "bc" ? "BC" : "Blog"} CSV
              </button>
              <button
                onClick={() => onPushSheets(proj)}
                disabled={ps === "pushing" || !sheetsUrl}
                className={`btn ${sheetsUrl ? "btn-primary" : "btn-secondary opacity-50 cursor-not-allowed"}`}
                title={!sheetsUrl ? "Configure spreadsheet URL in Settings" : ""}
              >
                {ps === "pushing"
                  ? "Pushing…"
                  : `Push ${proj === "bc" ? "BC" : "Blog"} to Sheets`}
              </button>
              {ps?.startsWith("error:") && (
                <span className="text-xs text-danger">{ps.slice(6)}</span>
              )}
            </div>
          );
        })()}
        {!sheetsUrl && (
          <Link to="/settings" className="text-xs text-muted underline">
            Configure Sheets URL
          </Link>
        )}
      </div>

      {/* Preview table */}
      <div className="card">
        <div className="flex items-center justify-between px-4 pt-3 pb-2.5 border-b border-border">
          <div className="inline-flex bg-surface-2 rounded-[6px] p-0.5">
            {["bc", "blog"].map((tab) => (
              <button
                key={tab}
                onClick={() => setPreviewTab(tab)}
                className={`px-3 py-1 rounded-[5px] text-xs font-medium transition-colors ${
                  previewTab === tab
                    ? "bg-surface text-ink shadow-card"
                    : "text-muted hover:text-ink"
                }`}
              >
                {tab === "bc" ? "BC" : "Blog"}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted font-mono">
            {matchCount}/{urlList.length} matched
          </span>
        </div>
        <PreviewTable
          project={previewTab}
          output={pagination.pageItems}
          slots={slots}
        />
        <div className="px-4 border-t border-border">
          <PaginationControls
            page={pagination.page}
            pageCount={pagination.pageCount}
            pageSize={pagination.pageSize}
            total={pagination.total}
            onPageSizeChange={pagination.setPageSize}
            onFirst={pagination.goFirst}
            onPrev={pagination.goPrev}
            onNext={pagination.goNext}
            onLast={pagination.goLast}
          />
        </div>
      </div>
    </div>
  );
}

const PREVIEW_METRICS = [
  { key: "rank", label: "Rank", fmt: (v) => (v ? v.toFixed(1) : null) },
  {
    key: "impressions",
    label: "Impr",
    fmt: (v) => (v ? String(Math.round(v)) : null),
  },
  { key: "clicks", label: "Clicks", fmt: (v) => v || null },
  {
    key: "ctr",
    label: "CTR",
    fmt: (v) => (v ? formatCTR(v) : null),
    dim: true,
  },
  { key: "views", label: "Views", fmt: (v) => v || null },
  { key: "users", label: "Users", fmt: (v) => v || null },
  { key: "sessions", label: "Sessions", fmt: (v) => v || null },
  {
    key: "aet",
    label: "AET",
    fmt: (v) => (v ? secondsToHmmss(v) : null),
    dim: true,
  },
];

function PreviewTable({ project, output, slots }) {
  if (output.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted">No URLs in list</div>
    );
  }

  const labelCol = project === "bc" ? "main_keyword" : "keyword";

  return (
    <div className="overflow-x-auto">
      <table className="text-xs w-full">
        <thead className="bg-surface-2 sticky top-0">
          <tr>
            <th className="text-left py-2 px-3 font-mono text-2xs uppercase tracking-wider text-muted sticky left-0 bg-surface-2 z-10 min-w-[140px]">
              Keyword
            </th>
            <th className="text-left py-2 px-2 font-mono text-2xs uppercase tracking-wider text-muted min-w-[120px]">
              Slug
            </th>
            {PREVIEW_METRICS.map((m) => (
              <th
                key={m.key}
                colSpan={slots.length}
                className="text-center py-2 px-2 font-mono text-2xs uppercase tracking-wider text-muted border-l border-border"
              >
                {m.label}
              </th>
            ))}
          </tr>
          <tr className="bg-surface-2">
            <th className="sticky left-0 bg-surface-2 z-10" />
            <th />
            {PREVIEW_METRICS.flatMap((m) =>
              slots.map((s, si) => (
                <th
                  key={`${m.key}_${s.key}`}
                  className={`text-center py-1 px-1.5 font-mono text-2xs text-muted border-l ${
                    si === 0 ? "border-border" : "border-border/50"
                  }`}
                >
                  {s.label.split(" ")[0]}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {output.map(({ urlRow, metrics }, i) => {
            const hasData =
              metrics.clicks.some((v) => v > 0) ||
              metrics.views.some((v) => v > 0);
            return (
              <tr
                key={i}
                className={`hover:bg-surface-2/50 ${!hasData ? "opacity-40" : ""}`}
              >
                <td
                  className="py-1.5 px-3 sticky left-0 bg-surface z-10 max-w-[140px] truncate text-ink"
                  title={urlRow[labelCol]}
                >
                  {urlRow[labelCol] || "—"}
                </td>
                <td
                  className="py-1.5 px-2 font-mono text-muted max-w-[120px] truncate"
                  title={urlRow.slug}
                >
                  {urlRow.slug || "—"}
                </td>
                {PREVIEW_METRICS.flatMap((m) =>
                  metrics[m.key].map((v, si) => (
                    <td
                      key={`${m.key}_${si}`}
                      className={`py-1.5 px-1.5 text-center font-mono ${m.dim ? "text-muted" : "text-ink"} border-l ${
                        si === 0 ? "border-border" : "border-border/50"
                      }`}
                    >
                      {m.fmt(v) ?? <Dash />}
                    </td>
                  )),
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Dash() {
  return <span className="text-empty">—</span>;
}
