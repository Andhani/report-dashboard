import { useState, useRef, useCallback, useMemo, useLayoutEffect } from "react";
import { Link } from "react-router-dom";
import { useStorage } from "../hooks/useStorage";
import { useDataContext } from "../context/DataContext";
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
import { computeFlow1Output, buildCSVData } from "../utils/computeFlow1";
import { downloadCSV, readFileAsArrayBuffer } from "../utils/exportUtils";
import {
  pushFlow1ToSheets,
  extractSpreadsheetId,
  buildWorkbookFromSheet,
} from "../utils/sheetsApi";
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

const BC_URL_COLS = [
  { key: "main_keyword", label: "Main Keyword" },
  { key: "offer", label: "Offer" },
  { key: "property", label: "Property" },
  { key: "url", label: "URL" },
  { key: "publish", label: "Publish" },
  { key: "status", label: "Status" },
  { key: "pic", label: "PIC" },
  { key: "slug", label: "Slug" },
];

const BLOG_URL_COLS = [
  { key: "keyword", label: "Keyword" },
  { key: "url", label: "URL" },
  { key: "status", label: "Status" },
  { key: "publish_date", label: "Publish Date" },
  { key: "content_type", label: "Content Type" },
  { key: "pic", label: "PIC" },
  { key: "slug", label: "Slug" },
];

export default function Flow1() {
  const { flow1Data, setFlow1Data, flow1MissingKeys, flow1WriteError } =
    useDataContext();
  const [flow1Window] = useStorage("flow1_window", null);
  const [bcUrls] = useStorage("bc_urls", []);
  const [blogUrls] = useStorage("blog_urls", []);
  const [sheetsUrl] = useStorage("sheets_report_url", "");

  const [log, setLog] = useStorage("flow1_log", []);
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [previewTab, setPreviewTab] = useStorage("flow1_preview_tab", "bc");
  const [pushStatus, setPushStatus] = useState({});
  const [pushModal, setPushModal] = useState(false);
  const [importMode, setImportMode] = useStorage("flow1_import_mode", "sheets");
  const [sheetUrl, setSheetUrl] = useStorage("flow1_sheet_url", "");
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState(null);
  const fileRef = useRef();

  const slots = flow1Window ? getMonthSlots(flow1Window, 6) : [];
  const slotKeys = new Set(slots.map((s) => s.key));

  // ─── File processing ────────────────────────────────────────────────────────

  async function processFiles(files) {
    setProcessing(true);
    const newEntries = {};
    const newLog = [];

    for (const file of Array.from(files)) {
      if (!file.name.match(/\.(xlsx|csv)$/i)) {
        newLog.push({
          file: file.name,
          status: "skip",
          message: "Not an .xlsx or .csv file — skipped",
        });
        continue;
      }
      try {
        const buf = await readFileAsArrayBuffer(file);
        const result = await parseFlow1File(buf, file.name);

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

        newEntries[key] = { rows: result.rows, file: file.name, chartAgg: result.chartAgg, grandTotal: result.grandTotal };
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
    setLog((prev) => [...newLog, ...prev].slice(0, 100));
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
    // Request all relevant tab patterns in one call. When any pattern has no
    // name match, buildWorkbookFromSheet fetches every remaining tab so the
    // structural fallback helpers in the parsers can identify the right sheet
    // by column/row content rather than by name.
    const wb = await buildWorkbookFromSheet(url, [
      "filters",
      "pages",
      "freeform",
    ]);
    const result = parseFlow1Workbook(wb);
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
      [key]: { rows: result.rows, file: "Google Sheet", chartAgg: result.chartAgg, grandTotal: result.grandTotal },
    }));
    setLog((prev) =>
      [
        {
          file: "Google Sheet",
          status: inWindow ? "ok" : "warn",
          message:
            formatDetectionLabel(result) +
            (inWindow ? "" : " ⚠ outside current window"),
          key,
        },
        ...prev,
      ].slice(0, 100),
    );
  }

  async function handleSheetImport() {
    setSheetError(null);
    setSheetLoading(true);
    try {
      await importFromSheetLink(sheetUrl.trim());
      setSheetUrl("");
    } catch (err) {
      setSheetError(err.message);
    } finally {
      setSheetLoading(false);
    }
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
      const csvRows = buildCSVData(project, output, slots);
      await pushFlow1ToSheets(ssId, project, csvRows);
      setPushStatus((p) => ({ ...p, [project]: null }));
      setPushModal(true);
    } catch (err) {
      setPushStatus((p) => ({ ...p, [project]: "error:" + err.message }));
    }
  }

  // ─── Slot state helpers ──────────────────────────────────────────────────────

  function slotStatus(row, slotKey) {
    return flow1Data[`${row}_${slotKey}`] ? "ok" : "empty";
  }

  function slotTooltip(row, slotKey) {
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
        <SheetPushModal
          sheetsUrl={sheetsUrl}
          onClose={() => setPushModal(false)}
        />
      )}
      <div className="space-y-5">
        {/* What-to-upload guide */}
        <UploadGuide />

        {/* Import section with mode toggle */}
        <div className="space-y-3">
          <div className="inline-flex bg-surface-2 rounded-[6px] p-0.5 gap-0.5">
            <button
              onClick={() => setImportMode("sheets")}
              className={`px-3 py-1 rounded-[5px] text-xs font-medium transition-all ${
                importMode === "sheets"
                  ? "bg-surface text-ink shadow-card"
                  : "text-muted hover:text-ink"
              }`}
            >
              From Sheets
            </button>
            <button
              onClick={() => setImportMode("file")}
              className={`px-3 py-1 rounded-[5px] text-xs font-medium transition-all ${
                importMode === "file"
                  ? "bg-surface text-ink shadow-card"
                  : "text-muted hover:text-ink"
              }`}
            >
              Upload File
            </button>
          </div>

          {importMode === "sheets" ? (
            <div className="card p-4 space-y-3">
              <input
                type="url"
                className="input"
                placeholder="https://docs.google.com/spreadsheets/d/..."
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
              />
              <p className="text-xs text-muted">
                Share with <strong>"Anyone with the link can view."</strong>{" "}
                Keep original export as-is, no restructure. Sheets
                auto-detected.
              </p>
              {sheetError && (
                <div className="text-xs text-danger">{sheetError}</div>
              )}
              <button
                onClick={handleSheetImport}
                disabled={!sheetUrl.trim() || sheetLoading}
                className="btn-primary disabled:opacity-50"
              >
                {sheetLoading ? "Importing…" : "Import"}
              </button>
            </div>
          ) : (
            <>
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
                accept=".xlsx,.csv"
                multiple
                className="hidden"
                onChange={(e) => {
                  processFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </>
          )}
        </div>

        {/* Detection log */}
        {log.length > 0 && (
          <DetectionLog log={log} onClear={() => setLog([])} />
        )}

        {/* Storage warnings */}
        {(flow1MissingKeys.length > 0 || flow1WriteError) && (
          <div className="card p-3 border-warning/40 bg-warning/5 flex items-start gap-2.5 text-xs">
            <AlertTriangle
              size={14}
              className="text-warning flex-shrink-0 mt-0.5"
              strokeWidth={2}
            />
            <div className="space-y-1">
              {flow1MissingKeys.length > 0 && (
                <p className="text-ink">
                  <strong>
                    Some data could not be recovered from browser storage
                  </strong>{" "}
                  and needs to be re-imported:{" "}
                  <span className="font-mono text-muted">
                    {flow1MissingKeys.join(", ")}
                  </span>
                </p>
              )}
              {flow1WriteError && <p className="text-ink">{flow1WriteError}</p>}
            </div>
          </div>
        )}

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
      <div className="text-xs font-semibold text-ink mb-1">{title}</div>
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
    { label: "BC GSC Export Dijual", detail: "Page filter set to /dijual/ in GSC" },
    { label: "BC GSC Export Disewa", detail: "Page filter set to /disewa/ in GSC" },
    { label: "Blog GSC Export", detail: "Page filter set to /articles-all/ in GSC" },
    { label: "BC GA4 Export Dijual", detail: "Query string set to /dijual/ in GA4" },
    { label: "BC GA4 Export Disewa", detail: "Query string set to /disewa/ in GA4" },
    { label: "Blog GA4 Export", detail: "Query string set to /articles-all/ in GA4" },
  ];
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold text-ink mb-1">What to upload</div>
      <p className="text-xs text-muted mb-2">
        Upload either the original export file or a sheet URL. Just drop the
        file as-is, it auto-detects the right sheet.
      </p>
      <ol className="space-y-1.5">
        {rows.map((r, i) => (
          <li key={r.label} className="flex items-start gap-2 text-xs text-ink">
            <span className="flex-shrink-0 text-muted w-4 text-right">{i + 1}.</span>
            <span>
              {r.label} <span className="text-muted">— {r.detail}</span>
            </span>
          </li>
        ))}
      </ol>
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
          <div className="text-xs font-semibold text-ink mb-1">
            {dragging ? "Drop files here" : "Drag & drop .xlsx or .csv files"}
          </div>
          <div className="text-xs text-muted mb-4">
            Original GSC or GA4 export, no restructure. Sheets auto-detected.
          </div>
          <div className="btn-secondary pointer-events-none">Browse files</div>
        </>
      )}
    </div>
  );
}

// ─── Detection Log ────────────────────────────────────────────────────────────

const LOG_ICONS = {
  ok: (
    <CheckCircle2
      size={13}
      className="text-ok flex-shrink-0 mt-0.5"
      strokeWidth={2}
    />
  ),
  warn: (
    <AlertTriangle
      size={13}
      className="text-pending flex-shrink-0 mt-0.5"
      strokeWidth={2}
    />
  ),
  error: (
    <XCircle
      size={13}
      className="text-danger flex-shrink-0 mt-0.5"
      strokeWidth={2}
    />
  ),
  skip: (
    <MinusCircle
      size={13}
      className="text-empty flex-shrink-0 mt-0.5"
      strokeWidth={2}
    />
  ),
};

function DetectionLog({ log, onClear }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-ink">Detection Log</h3>
        <button onClick={onClear} className="text-xs text-muted hover:text-ink">
          Clear
        </button>
      </div>
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {log.map((entry, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            {LOG_ICONS[entry.status]}
            <span
              className="text-muted truncate max-w-[200px]"
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
  { id: "bc_gsc_dijual", source: "BC GSC Export", segment: "/dijual/" },
  { id: "bc_gsc_disewa", source: "BC GSC Export", segment: "/disewa/" },
  { id: "blog_gsc", source: "Blog GSC Export", segment: "/articles-all/" },
  {
    id: "blog_ga4",
    source: "Blog GA4 Export",
    segment: "/articles-all/",
    subtitle: "Organic Google",
  },
  {
    id: "bc_ga4_dijual",
    source: "BC GA4 Export",
    segment: "/dijual/",
    subtitle: "Organic Google",
  },
  {
    id: "bc_ga4_disewa",
    source: "BC GA4 Export",
    segment: "/disewa/",
    subtitle: "Organic Google",
  },
];

function SlotGrid({ slots, slotStatus, slotTooltip, flow1Data, onClearSlot }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-ink">Slot Status</h2>
        <div className="flex items-center gap-4 text-2xs text-muted">
          <span>
            <span className="dot-ok">●</span> filled
          </span>
          <span>
            <span className="dot-empty">●</span> empty
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left text-2xs uppercase tracking-wide text-muted font-medium pb-2 pr-4 w-36">
                Source
              </th>
              <th className="text-left text-2xs uppercase tracking-wide text-muted font-medium pb-2 pr-4 whitespace-nowrap">
                Segment
              </th>
              {slots.map((s) => (
                <th
                  key={s.key}
                  className="text-center text-2xs uppercase tracking-wide text-muted font-medium pb-2 px-3 min-w-[76px]"
                >
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {SLOT_ROWS.map((row, ri) => (
              <tr
                key={row.id}
                className={ri % 2 === 1 ? "bg-surface-2/40" : ""}
              >
                <td className="py-2.5 pr-4">
                  <div className="text-ink text-xs">{row.source}</div>
                  {row.subtitle && (
                    <div className="text-2xs text-muted">{row.subtitle}</div>
                  )}
                </td>
                <td className="py-2.5 pr-4 text-2xs text-muted whitespace-nowrap">
                  {row.segment}
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
    onClear(`${rowId}_${slotKey}`);
  }

  return (
    <div
      className="inline-flex items-center gap-1"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={tooltip}
    >
      <span className={`dot-${status} text-sm`}>●</span>
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
  const urlCols = previewTab === "bc" ? BC_URL_COLS : BLOG_URL_COLS;
  const output = computeFlow1Output(previewTab, urlList, flow1Data, slots);
  const matchCount = output.filter(
    (r) =>
      r.metrics.clicks.some((v) => v > 0) || r.metrics.views.some((v) => v > 0),
  ).length;

  // Column filters (Sheets/Excel-style, same behavior as the URL Manager tab),
  // scoped to this preview table only.
  const [filters, setFilters] = useState({});
  const columns = useMemo(
    () => buildPreviewColumns(urlCols, slots),
    [urlCols, slots],
  );
  const filteredOutput = useMemo(
    () => applyPreviewFilters(output, columns, filters),
    [output, columns, filters],
  );
  const activeFilterCount = Object.keys(filters).length;
  const pagination = usePagination(filteredOutput, 100);

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
                title={
                  !sheetsUrl ? "Configure spreadsheet URL in Settings" : ""
                }
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
          <div className="flex items-center gap-2.5">
            <span className="text-2xs text-muted">
              {matchCount}/{urlList.length} matched
            </span>
            {activeFilterCount > 0 && (
              <>
                <span className="text-2xs text-muted">
                  · {filteredOutput.length} of {output.length} rows
                </span>
                <button
                  onClick={() => setFilters({})}
                  className="text-2xs text-accent hover:underline"
                >
                  Clear filters ({activeFilterCount})
                </button>
              </>
            )}
          </div>
        </div>
        <PreviewTable
          output={pagination.pageItems}
          allOutput={output}
          slots={slots}
          urlCols={urlCols}
          filters={filters}
          onFilterChange={setFilters}
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
  {
    key: "rank",
    label: "Rank",
    source: "GSC Web",
    fmt: (v) => (v ? v.toFixed(1) : null),
  },
  {
    key: "impressions",
    label: "Impressions",
    source: "GSC Web",
    fmt: (v) => (v ? String(Math.round(v)) : null),
  },
  { key: "clicks", label: "Clicks", source: "GSC Web", fmt: (v) => v || null },
  {
    key: "ctr",
    label: "CTR",
    source: "GSC Web",
    fmt: (v) => (v ? formatCTR(v) : null),
    dim: true,
  },
  { key: "views", label: "Views", source: "GA4", fmt: (v) => v || null },
  { key: "users", label: "Active Users", source: "GA4", fmt: (v) => v || null },
  { key: "sessions", label: "Sessions", source: "GA4", fmt: (v) => v || null },
  {
    key: "aet",
    label: "AET",
    source: "GA4",
    fmt: (v) => (v ? secondsToHmmss(v) : null),
    dim: true,
  },
];

function PreviewTable({
  output,
  allOutput,
  slots,
  urlCols,
  filters,
  onFilterChange,
}) {
  const [openFilterKey, setOpenFilterKey] = useState(null);

  if (allOutput.length === 0) {
    return (
      <div className="p-8 text-center text-xs text-muted">No URLs in list</div>
    );
  }

  function applyFilter(colId, values) {
    onFilterChange((prev) => {
      const next = { ...prev };
      if (values === null) delete next[colId];
      else next[colId] = values;
      return next;
    });
    setOpenFilterKey(null);
  }

  const totalCols = urlCols.length + PREVIEW_METRICS.length * slots.length;

  return (
    <div className="overflow-auto max-h-[70vh]">
      <table className="text-xs w-full">
        <thead className="bg-surface-2 sticky top-0 z-20">
          <tr>
            {urlCols.map((col, ci) => {
              const colId = `url:${col.key}`;
              return (
                <th
                  key={col.key}
                  className={`relative text-center py-2 px-2 text-2xs uppercase tracking-wider text-muted ${
                    ci === 0
                      ? "sticky left-0 bg-surface-2 z-10 min-w-[140px]"
                      : "min-w-[80px]"
                  }`}
                >
                  <div className="flex items-center justify-center gap-1">
                    <span className="truncate">{col.label}</span>
                    <PreviewColumnFilter
                      colId={colId}
                      allItems={allOutput}
                      getValue={(item) => getUrlColValue(item, col)}
                      activeValues={filters[colId]}
                      open={openFilterKey === colId}
                      onToggle={() =>
                        setOpenFilterKey((k) => (k === colId ? null : colId))
                      }
                      onClose={() => setOpenFilterKey(null)}
                      onApply={(values) => applyFilter(colId, values)}
                    />
                  </div>
                </th>
              );
            })}
            {PREVIEW_METRICS.map((m) => (
              <th
                key={m.key}
                colSpan={slots.length}
                className="text-center py-1.5 px-2 text-2xs text-muted border-l border-border"
              >
                <div className="uppercase tracking-wider">{m.label}</div>
                <div className="text-[10px] text-muted/60 normal-case tracking-normal mt-0.5">
                  {m.source}
                </div>
              </th>
            ))}
          </tr>
          <tr className="bg-surface-2">
            {urlCols.map((col, ci) => (
              <th
                key={col.key}
                className={ci === 0 ? "sticky left-0 bg-surface-2 z-10" : ""}
              />
            ))}
            {PREVIEW_METRICS.flatMap((m) =>
              slots.map((s, si) => {
                const colId = `metric:${m.key}:${s.key}`;
                return (
                  <th
                    key={colId}
                    className={`relative text-center py-1 px-1.5 text-2xs text-muted border-l whitespace-nowrap ${
                      si === 0 ? "border-border" : "border-border/50"
                    }`}
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span>{s.label.split(" ")[0]}</span>
                      <PreviewColumnFilter
                        colId={colId}
                        allItems={allOutput}
                        getValue={(item) => getMetricColValue(item, m, si)}
                        activeValues={filters[colId]}
                        open={openFilterKey === colId}
                        onToggle={() =>
                          setOpenFilterKey((k) => (k === colId ? null : colId))
                        }
                        onClose={() => setOpenFilterKey(null)}
                        onApply={(values) => applyFilter(colId, values)}
                      />
                    </div>
                  </th>
                );
              }),
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {output.length === 0 ? (
            <tr>
              <td
                colSpan={totalCols}
                className="p-8 text-center text-xs text-muted"
              >
                No rows match the current filters.
              </td>
            </tr>
          ) : (
            output.map(({ urlRow, metrics }, i) => {
              const hasData =
                metrics.clicks.some((v) => v > 0) ||
                metrics.views.some((v) => v > 0);
              return (
                <tr
                  key={i}
                  className={`hover:bg-surface-2/50 ${!hasData ? "opacity-40" : ""}`}
                >
                  {urlCols.map((col, ci) => (
                    <td
                      key={col.key}
                      className={`py-1.5 px-2 truncate max-w-[160px] ${
                        ci === 0
                          ? "sticky left-0 bg-surface z-10 text-ink px-3"
                          : "text-muted"
                      }`}
                      title={urlRow[col.key]}
                    >
                      {urlRow[col.key] || "—"}
                    </td>
                  ))}
                  {PREVIEW_METRICS.flatMap((m) =>
                    metrics[m.key].map((v, si) => (
                      <td
                        key={`${m.key}_${si}`}
                        className={`py-1.5 px-1.5 text-center tabular-nums ${m.dim ? "text-muted" : "text-ink"} border-l ${
                          si === 0 ? "border-border" : "border-border/50"
                        }`}
                      >
                        {m.fmt(v) ?? <Dash />}
                      </td>
                    )),
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function Dash() {
  return <span className="text-empty">—</span>;
}

// ─── Column filters (Sheets/Excel-style, same behavior as the URL Manager
// tab's ColumnFilter) — kept local to this preview table only. ────────────────

function getUrlColValue(item, col) {
  return item.urlRow[col.key] ?? "";
}

function getMetricColValue(item, m, si) {
  const formatted = m.fmt(item.metrics[m.key][si]);
  return formatted === null || formatted === undefined ? "" : String(formatted);
}

function buildPreviewColumns(urlCols, slots) {
  const urlColumns = urlCols.map((col) => ({
    id: `url:${col.key}`,
    get: (item) => getUrlColValue(item, col),
  }));
  const metricColumns = PREVIEW_METRICS.flatMap((m) =>
    slots.map((s, si) => ({
      id: `metric:${m.key}:${s.key}`,
      get: (item) => getMetricColValue(item, m, si),
    })),
  );
  return [...urlColumns, ...metricColumns];
}

function applyPreviewFilters(items, columns, filters) {
  const entries = Object.entries(filters);
  if (entries.length === 0) return items;
  return items.filter((item) =>
    entries.every(([colId, values]) => {
      const col = columns.find((c) => c.id === colId);
      return col ? values.has(col.get(item)) : true;
    }),
  );
}

const PREVIEW_FILTER_BLANK_VALUE = "";
const PREVIEW_FILTER_BLANK_LABEL = "(Blanks)";

function PreviewColumnFilter({
  allItems,
  getValue,
  activeValues,
  open,
  onToggle,
  onClose,
  onApply,
}) {
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState(() => new Set(activeValues || []));

  const counts = useMemo(() => {
    const map = new Map();
    allItems.forEach((item) => {
      const v = getValue(item);
      map.set(v, (map.get(v) || 0) + 1);
    });
    return [...map.entries()].sort((a, b) => {
      if (a[0] === PREVIEW_FILTER_BLANK_VALUE) return -1;
      if (b[0] === PREVIEW_FILTER_BLANK_VALUE) return 1;
      return a[0].localeCompare(b[0], undefined, { numeric: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItems]);

  const allValues = useMemo(() => counts.map(([v]) => v), [counts]);

  // Reset the draft selection each time the popover opens.
  useLayoutEffect(() => {
    if (open) {
      setDraft(new Set(activeValues ? activeValues : allValues));
      setSearch("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) {
    const isFiltered = activeValues && activeValues.size < allValues.length;
    return (
      <button
        onClick={onToggle}
        title="Filter"
        className={`shrink-0 p-0.5 rounded hover:bg-accent/10 ${isFiltered ? "text-accent" : "text-muted"}`}
      >
        <PreviewFilterIcon filled={isFiltered} />
      </button>
    );
  }

  const q = search.trim().toLowerCase();
  const visible = q
    ? counts.filter(([v]) =>
        (v === PREVIEW_FILTER_BLANK_VALUE ? PREVIEW_FILTER_BLANK_LABEL : v)
          .toLowerCase()
          .includes(q),
      )
    : counts;

  function toggleValue(v) {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  return (
    <>
      <button
        onClick={onToggle}
        title="Filter"
        className="shrink-0 p-0.5 rounded text-accent bg-accent/10"
      >
        <PreviewFilterIcon filled />
      </button>
      {/* Backdrop closes the popover on outside click */}
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div
        className="absolute left-0 top-full mt-1 z-30 w-60 bg-surface border border-border rounded-card shadow-card p-2 normal-case font-normal tracking-normal text-left"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="text"
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search values…"
          className="input text-xs w-full mb-1.5"
        />
        <div className="flex items-center justify-between text-2xs mb-1.5">
          <button
            className="text-accent hover:underline"
            onClick={() =>
              setDraft((prev) => {
                const next = new Set(prev);
                visible.forEach(([v]) => next.add(v));
                return next;
              })
            }
          >
            Select all
          </button>
          <button
            className="text-accent hover:underline"
            onClick={() =>
              setDraft((prev) => {
                const next = new Set(prev);
                visible.forEach(([v]) => next.delete(v));
                return next;
              })
            }
          >
            Clear
          </button>
        </div>
        <div className="max-h-52 overflow-y-auto space-y-0.5 border-t border-b border-border py-1">
          {visible.length === 0 && (
            <div className="text-2xs text-muted px-1 py-2 text-center">
              No matching values
            </div>
          )}
          {visible.map(([v, count]) => (
            <label
              key={v || "__blank__"}
              className="flex items-center gap-1.5 text-xs px-1 py-0.5 rounded hover:bg-accent/5 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={draft.has(v)}
                onChange={() => toggleValue(v)}
                className="shrink-0"
              />
              <span
                className="truncate flex-1"
                title={v || PREVIEW_FILTER_BLANK_LABEL}
              >
                {v === PREVIEW_FILTER_BLANK_VALUE ? (
                  <span className="text-muted italic">
                    {PREVIEW_FILTER_BLANK_LABEL}
                  </span>
                ) : (
                  v
                )}
              </span>
              <span className="text-2xs text-muted shrink-0">{count}</span>
            </label>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 mt-1.5">
          <button className="btn-ghost text-2xs" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary text-2xs px-2 py-1"
            onClick={() =>
              onApply(draft.size === allValues.length ? null : draft)
            }
          >
            Apply
          </button>
        </div>
      </div>
    </>
  );
}

function PreviewFilterIcon({ filled }) {
  return (
    <svg
      className="w-3 h-3"
      viewBox="0 0 20 20"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.5}
    >
      <path d="M3 4h14l-5.5 6.5v5l-3 1.5v-6.5z" strokeLinejoin="round" />
    </svg>
  );
}
