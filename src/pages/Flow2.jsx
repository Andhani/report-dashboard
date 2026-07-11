import { useState, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import { useStorage, useChunkedStorage } from "../hooks/useStorage";
import {
  getMonthSlots,
  formatMonthKey,
  secondsToHmmss,
} from "../utils/dateUtils";
import {
  parseFlow2File,
  parseGSCChartWorkbook,
  parseGA4FreeFile,
  parseGA4LeadsFile,
  getFlow2DataKey,
  formatFlow2DetectionLabel,
} from "../utils/parseFlow2";
import {
  computeFlow2Output,
  buildFlow2CSV,
  SEGMENTS,
  METRICS,
  formatMetricValue,
} from "../utils/computeFlow2";
import { downloadCSV, readFileAsArrayBuffer } from "../utils/exportUtils";
import {
  pushFlow2ToSheets,
  extractSpreadsheetId,
  buildWorkbookFromSheet,
  fetchFirstTabAsCSV,
} from "../utils/sheetsApi";
import {
  Upload,
  Link2,
  Settings,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  MinusCircle,
  X,
} from "lucide-react";
import SheetPushModal from "../components/SheetPushModal";

export default function Flow2() {
  const [flow2Data, setFlow2Data] = useChunkedStorage("flow2_data", {});
  const [flow1Data] = useChunkedStorage("flow1_data", {});
  const [flow2Window] = useStorage("flow2_window", null);
  const [sheetsUrl] = useStorage("sheets_report_url", "");

  const mergedForCompute = useMemo(() => {
    const merged = { ...flow2Data };
    for (const [k, v] of Object.entries(flow1Data)) {
      if (k.startsWith("bc_gsc_dijual_")) merged[`gsc_dijual_${k.slice(14)}`] = v;
      else if (k.startsWith("bc_gsc_disewa_")) merged[`gsc_disewa_${k.slice(14)}`] = v;
      else if (k.startsWith("blog_gsc_")) merged[`gsc_blog_${k.slice(9)}`] = v;
    }
    return merged;
  }, [flow1Data, flow2Data]);

  const [log, setLog] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pushStatus, setPushStatus] = useState(null);
  const [pushModal, setPushModal] = useState(false);
  const [importMode, setImportMode] = useState("sheets");
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState(null);
  const fileRef = useRef();

  const slots = flow2Window ? getMonthSlots(flow2Window, 6) : [];
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
          message: "Not .xlsx or .csv — skipped",
        });
        continue;
      }
      try {
        const buf = await readFileAsArrayBuffer(file);
        const result = await parseFlow2File(file, buf);

        if (!result) {
          newLog.push({
            file: file.name,
            status: "error",
            message:
              "Could not detect file — check it is a GSC Export (.xlsx) or GA4 / Event GA4 Export (.csv)",
          });
          continue;
        }

        const key = getFlow2DataKey(result);
        if (!key) {
          newLog.push({
            file: file.name,
            status: "warn",
            message: "Detected but key could not be generated — skipped",
          });
          continue;
        }

        const mk = formatMonthKey(result.month.year, result.month.month);
        const inWindow = slotKeys.has(mk);

        newEntries[key] = result;

        newLog.push({
          file: file.name,
          status: inWindow ? "ok" : "warn",
          message:
            formatFlow2DetectionLabel(result) +
            (inWindow ? "" : " ⚠ outside current window"),
        });
      } catch (err) {
        newLog.push({ file: file.name, status: "error", message: err.message });
      }
    }

    setFlow2Data((prev) => ({ ...prev, ...newEntries }));
    setLog((prev) => [...newLog, ...prev]);
    setProcessing(false);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    processFiles(Array.from(e.dataTransfer.files));
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
    setFlow2Data((prev) => {
      const n = { ...prev };
      delete n[key];
      return n;
    });
  }

  // ─── Import from a Google Sheet link ────────────────────────────────────────

  async function importFromSheetLink(url) {
    let wb = await buildWorkbookFromSheet(url, ["chart", "filters"]);
    let result = wb.SheetNames.includes("Chart")
      ? parseGSCChartWorkbook(wb)
      : null;

    if (!result) {
      const csvText = await fetchFirstTabAsCSV(url);
      const lines = csvText.split("\n");
      const isLeads =
        (lines[2] ?? "").toLowerCase().includes("leads") ||
        (lines[6] ?? "").toLowerCase().includes("key events");
      result = isLeads ? parseGA4LeadsFile(csvText) : parseGA4FreeFile(csvText);
    }

    if (!result) {
      throw new Error(
        "Could not find a GSC Export tab (Chart + Filters) or a GA4/Event GA4 Export layout in that sheet.",
      );
    }

    const key = getFlow2DataKey(result);
    if (!key) throw new Error("Detected but key could not be generated.");

    const mk = formatMonthKey(result.month.year, result.month.month);
    const inWindow = slotKeys.has(mk);

    setFlow2Data((prev) => ({ ...prev, [key]: result }));
    setLog((prev) => [
      {
        file: "Google Sheet",
        status: inWindow ? "ok" : "warn",
        message:
          formatFlow2DetectionLabel(result) +
          (inWindow ? "" : " ⚠ outside current window"),
      },
      ...prev,
    ]);
  }

  // ─── Export ─────────────────────────────────────────────────────────────────

  function handleDownloadCSV() {
    const output = computeFlow2Output(mergedForCompute, slots);
    const csv = buildFlow2CSV(output, slots);
    const period = slots.length
      ? `${slots[0].label.replace(" ", "")}–${slots[slots.length - 1].label.replace(" ", "")}`
      : "";
    downloadCSV(csv, `Traffic_Overview_${period}.csv`);
  }

  async function handlePushSheets() {
    const ssId = extractSpreadsheetId(sheetsUrl);
    if (!ssId) {
      alert("No spreadsheet URL configured — add it in Settings.");
      return;
    }
    setPushStatus("pushing");
    try {
      const output = computeFlow2Output(mergedForCompute, slots);
      const csv = buildFlow2CSV(output, slots);
      await pushFlow2ToSheets(ssId, csv);
      setPushStatus(null);
      setPushModal(true);
    } catch (err) {
      setPushStatus("error:" + err.message);
    }
  }

  // ─── Slot helpers ────────────────────────────────────────────────────────────

  const anyData = Object.keys(flow2Data).length > 0;

  if (!flow2Window) {
    return (
      <div className="max-w-md mx-auto mt-10 card py-10 px-8 flex flex-col items-center text-center border-dashed">
        <Settings size={24} className="text-muted mb-3" strokeWidth={1.5} />
        <div className="text-xs font-semibold text-ink mb-1">
          Rolling window not set
        </div>
        <p className="text-xs text-muted mb-4">
          Set the Traffic Overview start month in Settings (6-month window).
        </p>
        <Link to="/settings" className="btn-primary">
          Go to Settings
        </Link>
      </div>
    );
  }

  const output = anyData ? computeFlow2Output(mergedForCompute, slots) : null;

  return (
    <>
      {pushModal && (
        <SheetPushModal sheetsUrl={sheetsUrl} onClose={() => setPushModal(false)} />
      )}
    <div className="space-y-5">
      {/* What-to-upload guide */}
      <div className="card p-4 space-y-3">
        <div className="text-xs font-semibold text-ink">What to upload</div>

        <div>
          <p className="text-xs text-muted mb-1.5">Upload fresh each month</p>
          <ul className="space-y-1.5">
            {[
              { label: "GSC Export (All Segments)",  desc: "Site-wide totals, not per-URL" },
              { label: "GA4 Export (All Segments)",  desc: "A single file covering every segment automatically" },
              { label: "Event GA4 Export",           desc: "Click_Contact_Agent event count" },
            ].map((r) => (
              <li key={r.label} className="flex items-start gap-2 text-xs text-ink">
                <span className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 bg-muted" />
                <span>
                  {r.label}{" "}
                  <span className="text-muted">— {r.desc}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-xs text-muted mb-1.5">Reuse from Traffic (Optimized) — no need to upload here</p>
          <ul className="space-y-1.5">
            {["BC GSC Export", "Blog GSC Export", "Blog GA4 Export", "BC GA4 Export"].map(
              (label) => (
                <li key={label} className="flex items-start gap-2 text-xs text-ink">
                  <span className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 bg-accent" />
                  <span>{label}</span>
                </li>
              ),
            )}
          </ul>
        </div>
      </div>

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
              Share with{" "}
              <strong>"Anyone with the link can view."</strong> Keep original
              export as-is, no restructure. Sheets auto-detected.
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
      {log.length > 0 && <DetectionLog log={log} onClear={() => setLog([])} />}

      {/* Slot grid */}
      <SlotGrid
        slots={slots}
        flow1Data={flow1Data}
        flow2Data={flow2Data}
        onClear={clearSlot}
      />

      {/* Overview table + export */}
      {output && (
        <OverviewSection
          output={output}
          slots={slots}
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
            {dragging
              ? "Drop files here"
              : "Drag & drop Traffic Overview files"}
          </div>
          <p className="text-xs text-muted mb-4">
            Original GSC or GA4 export, no restructure. Sheets auto-detected.
          </p>
          <span className="btn-secondary pointer-events-none">
            Browse files
          </span>
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

const SLOT_ROWS_F2 = [
  { id: "gsc_all_organic", source: "GSC Export",       segment: "All Segments",        store: "flow2", prefix: "gsc_all_organic" },
  { id: "gsc_dijual",      source: "BC GSC Export",    segment: "/dijual/",             store: "flow1", prefix: "bc_gsc_dijual" },
  { id: "gsc_disewa",      source: "BC GSC Export",    segment: "/disewa/",             store: "flow1", prefix: "bc_gsc_disewa" },
  { id: "gsc_blog",        source: "Blog GSC Export",  segment: "/articles-all/",       store: "flow1", prefix: "blog_gsc" },
  { id: "ga4_free",        source: "GA4 Export",       segment: "All Segments",        store: "flow2", prefix: "ga4_free",  subtitle: "Organic Google" },
  { id: "ga4_leads",       source: "Event GA4 Export", segment: "click_contact_agent",  store: "flow2", prefix: "ga4_leads", subtitle: "Organic Google" },
  { id: "blog_ga4",        source: "Blog GA4 Export",  segment: "/articles-all/",       store: "flow1", prefix: "blog_ga4",  subtitle: "Organic Google" },
  { id: "bc_ga4",          source: "BC GA4 Export",    segment: "dijual + disewa",     store: "flow1", prefix: "bc_ga4",    subtitle: "Organic Google" },
];

function SlotGrid({ slots, flow1Data, flow2Data, onClear }) {
  let dataRowCount = 0;
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-ink">
          Slot Status
        </h2>
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
              <th className="text-left text-2xs uppercase tracking-wide text-muted font-medium pb-2 pr-4 w-32 whitespace-nowrap">
                Segment
              </th>
              {slots.map((s) => (
                <th
                  key={s.key}
                  className="text-center text-2xs uppercase tracking-wide text-muted font-medium pb-2 px-2 min-w-[64px]"
                >
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {SLOT_ROWS_F2.map((row, ri) => {
              const idx = dataRowCount++;
              const storeData = row.store === "flow1" ? flow1Data : flow2Data;
              const canClear = row.store === "flow2";
              return (
                <tr key={row.id} className={idx % 2 === 1 ? "bg-surface-2/40" : ""}>
                  <td className="py-2.5 pr-4">
                    <div className="text-ink text-xs">{row.source}</div>
                    {row.subtitle && (
                      <div className="text-2xs text-muted">{row.subtitle}</div>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-muted text-2xs whitespace-nowrap">{row.segment}</td>
                  {slots.map((s) => {
                    const key = `${row.prefix}_${s.key}`;
                    const filled = !!storeData[key];
                    return (
                      <td key={s.key} className="py-2.5 px-2 text-center">
                        <SlotDot
                          filled={filled}
                          onClear={canClear ? () => onClear(key) : null}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SlotDot({ filled, onClear }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="inline-flex items-center gap-1"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className={`${filled ? "dot-ok" : "dot-empty"} text-sm`}>●</span>
      {hover && filled && onClear && (
        <button onClick={onClear} className="text-muted hover:text-danger transition-colors">
          <X size={11} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

// ─── Overview Table ───────────────────────────────────────────────────────────

function OverviewSection({
  output,
  slots,
  onDownloadCSV,
  onPushSheets,
  pushStatus,
  sheetsUrl,
}) {
  const [activeSeg, setActiveSeg] = useState("all_organic");

  return (
    <div className="space-y-4">
      {/* Export bar */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <button onClick={onDownloadCSV} className="btn-secondary">
          Export CSV
        </button>
        <button
          onClick={onPushSheets}
          disabled={pushStatus === "pushing" || !sheetsUrl}
          className={`btn ${sheetsUrl ? "btn-primary" : "btn-secondary opacity-50 cursor-not-allowed"}`}
        >
          {pushStatus === "pushing" ? "Pushing…" : "Push to Sheets"}
        </button>
        {typeof pushStatus === "string" && pushStatus.startsWith("error:") && (
          <span className="text-xs text-danger">{pushStatus.slice(6)}</span>
        )}
        {!sheetsUrl && (
          <Link to="/settings" className="text-xs text-muted underline">
            Configure Sheets URL
          </Link>
        )}
      </div>

      {/* Segment tabs + metrics table */}
      <div className="card">
        <div className="flex px-4 pt-3 pb-2.5 border-b border-border overflow-x-auto">
          <div className="inline-flex bg-surface-2 rounded-[6px] p-0.5 gap-0.5">
            {SEGMENTS.map((seg) => (
              <button
                key={seg.id}
                onClick={() => setActiveSeg(seg.id)}
                className={`px-3 py-1 rounded-[5px] text-xs font-medium whitespace-nowrap transition-all ${
                  activeSeg === seg.id
                    ? "bg-surface text-ink shadow-card"
                    : "text-muted hover:text-ink"
                }`}
              >
                {seg.label}
              </button>
            ))}
          </div>
        </div>
        <SegmentTable segId={activeSeg} output={output} slots={slots} />
      </div>
    </div>
  );
}

function SegmentTable({ segId, output, slots }) {
  const segData = output[segId] ?? {};

  return (
    <div className="overflow-x-auto">
      <table className="text-xs w-full">
        <thead className="bg-surface-2">
          <tr>
            <th className="text-left py-2.5 px-4 text-2xs uppercase tracking-wider text-muted w-48 sticky left-0 bg-surface-2">
              Metric
            </th>
            {slots.map((s) => (
              <th
                key={s.key}
                className="text-center py-2.5 px-3 text-2xs uppercase tracking-wider text-muted min-w-[90px]"
              >
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {METRICS.filter((m) => !m.allOnly || segId === "all_organic").map(
            (metric, mi) => (
              <tr
                key={metric.id}
                className={`hover:bg-surface-2/50 ${mi % 2 === 1 ? "bg-surface-2/25" : ""}`}
              >
                <td className="py-2.5 px-4 text-ink text-xs sticky left-0 bg-surface">
                  {metric.label}
                </td>
                {slots.map((s) => {
                  const val = segData[s.key]?.[metric.id];
                  const hasData =
                    val !== null && val !== undefined && val !== 0;
                  return (
                    <td
                      key={s.key}
                      className={`py-2.5 px-3 text-center tabular-nums ${hasData ? "text-ink" : "text-empty"}`}
                    >
                      {hasData ? formatMetricValue(metric.id, val) : "—"}
                    </td>
                  );
                })}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
