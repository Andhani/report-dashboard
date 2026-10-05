import { useState, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import { useCloudStorage as useStorage } from "../hooks/useCloudStorage";
import { useDataContext } from "../context/DataContext";
import { describeWriteError } from "../context/CloudDataContext";
import {
  getMonthSlots,
  formatMonthKey,
  secondsToHmmss,
} from "../utils/dateUtils";
import {
  parseFlow2File,
  parseGSCChartWorkbook,
  parseGA4File,
  getFlow2DataKey,
  formatFlow2DetectionLabel,
} from "../utils/parseFlow2";
import {
  computeFlow2Output,
  mergeFlow1Reuse,
  buildFlow2CSV,
  withSheetLabels,
  SEGMENTS,
  ENTRY_SEGMENTS,
  METRICS,
  ENTRY_METRICS,
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
  const { flow1Data, flow2Data, setFlow2Data } = useDataContext();
  const [flow2Window] = useStorage("flow2_window", null);
  const [sheetsUrl] = useStorage("sheets_report_url", "");

  const mergedForCompute = useMemo(
    () => mergeFlow1Reuse(flow1Data, flow2Data),
    [flow1Data, flow2Data],
  );

  const [log, setLog] = useStorage("flow2_log", []);
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pushStatus, setPushStatus] = useState(null);
  // Which slot is being deleted, and why the last delete didn't land.
  const [clearing, setClearing] = useState(null);
  const [clearError, setClearError] = useState(null);
  const [pushModal, setPushModal] = useState(false);
  const [importMode, setImportMode] = useStorage("flow2_import_mode", "sheets");
  const [sheetUrl, setSheetUrl] = useStorage("flow2_sheet_url", "");
  const [activeSeg, setActiveSeg] = useStorage(
    "flow2_active_seg",
    "all_organic",
  );
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState(null);
  const fileRef = useRef();

  const slots = flow2Window ? getMonthSlots(flow2Window, 6) : [];
  const slotKeys = new Set(slots.map((s) => s.key));

  // ─── File processing ────────────────────────────────────────────────────────

  async function processFiles(files) {
    // Stamped on every entry from this upload so the log can report how many
    // files the batch contained — the count is the point of the check, and
    // deriving it from the entries avoids storing a separate tally.
    const batch = Date.now();
    const submitted = files.length;
    setProcessing(true);
    const newEntries = {};
    const newLog = [];
    const batchFiles = new Map();

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
              "Could not detect file — expected GSC Export, GA4 Export, or Event GA4 Export (.xlsx or .csv)",
          });
          continue;
        }

        const key = getFlow2DataKey(result);
        if (!key) {
          newLog.push({
            file: file.name,
            status: "warn",
            message: `${formatFlow2DetectionLabel(result)} — skipped`,
          });
          continue;
        }

        const mk = formatMonthKey(result.month.year, result.month.month);
        const inWindow = slotKeys.has(mk);

        // Two files in one batch landing on the same key means one of them
        // was misidentified; without this the second silently replaces the
        // first. Replacing a slot stored by an earlier batch is just a
        // re-import, so it is not flagged.
        const clash = batchFiles.get(key);
        batchFiles.set(key, file.name);
        newEntries[key] = result;

        newLog.push({
          file: file.name,
          status: inWindow && !clash ? "ok" : "warn",
          message:
            formatFlow2DetectionLabel(result) +
            (inWindow ? "" : " ⚠ outside current window") +
            (clash ? ` ⚠ same slot as "${clash}" — that file was replaced` : ""),
        });
      } catch (err) {
        newLog.push({ file: file.name, status: "error", message: err.message });
      }
    }

    setFlow2Data((prev) => ({ ...prev, ...newEntries }));
    setLog((prev) =>
      [...newLog.map((e) => ({ ...e, batch, submitted })), ...prev].slice(
        0,
        100,
      ),
    );
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

  // Awaited, and reported when it fails. Firing the delete and moving on
  // showed the slot as cleared while the documents were still in Firestore,
  // so the data was back on the next reload with no hint that anything had
  // gone wrong.
  async function clearSlot(key) {
    setClearError(null);
    setClearing(key);
    try {
      await setFlow2Data((prev) => {
        const n = { ...prev };
        delete n[key];
        return n;
      });
    } catch (err) {
      setClearError(`Couldn't clear that slot. ${describeWriteError(err)}`);
    } finally {
      setClearing(null);
    }
  }

  // ─── Import from a Google Sheet link ────────────────────────────────────────

  async function importFromSheetLink(url) {
    const wb = await buildWorkbookFromSheet(url, ["chart", "filters"]);
    // parseGSCChartWorkbook now uses flexible name + structure detection internally.
    let result = parseGSCChartWorkbook(wb);

    if (!result) {
      result = parseGA4File(await fetchFirstTabAsCSV(url));
    }

    if (!result) {
      throw new Error(
        "Could not find a GSC Export tab (Chart + Filters) or a GA4 Export layout in that sheet.",
      );
    }

    const key = getFlow2DataKey(result);
    if (!key) throw new Error("Detected but key could not be generated.");

    const mk = formatMonthKey(result.month.year, result.month.month);
    const inWindow = slotKeys.has(mk);

    setFlow2Data((prev) => ({ ...prev, [key]: result }));
    setLog((prev) =>
      [
        {
          file: "Google Sheet",
          status: inWindow ? "ok" : "warn",
          message:
            formatFlow2DetectionLabel(result) +
            (inWindow ? "" : " ⚠ outside current window"),
          batch: Date.now(),
          submitted: 1,
        },
        ...prev,
      ].slice(0, 100),
    );
  }

  // ─── Export ─────────────────────────────────────────────────────────────────

  function handleDownloadCSV() {
    const output = computeFlow2Output(mergedForCompute, slots);
    const csv = buildFlow2CSV(output, withSheetLabels(mergedForCompute, slots));
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
      const csv = buildFlow2CSV(
        output,
        withSheetLabels(mergedForCompute, slots),
      );
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

        {/* A delete that Firestore refused, so the slot is still stored */}
        {clearError && (
          <div className="card p-3 border-warning/40 bg-warning/5 flex items-start gap-2.5 text-xs">
            <AlertTriangle
              size={14}
              className="text-warning flex-shrink-0 mt-0.5"
              strokeWidth={2}
            />
            <p className="text-ink">{clearError}</p>
          </div>
        )}

        {/* Slot grid */}
        <SlotGrid
          slots={slots}
          flow1Data={flow1Data}
          flow2Data={flow2Data}
          onClear={clearSlot}
          clearingKey={clearing}
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
            activeSeg={activeSeg}
            setActiveSeg={setActiveSeg}
          />
        )}
      </div>
    </>
  );
}

// ─── What to upload ───────────────────────────────────────────────────────────

// Every file the two tables can take, grouped the way they are gathered in
// GA4/GSC. Nothing here is required: a segment with no export simply leaves
// its block blank, so a partial month still exports.
const UPLOAD_GROUPS = [
  {
    title: "Per segment — main table",
    note: "One of each per segment, per month. Ten segments, filtered in GSC/GA4.",
    items: [
      { label: "GSC Export", desc: "Chart + Filters, filtered to the segment" },
      {
        label: "GA4 Export",
        desc: "Page path · Views, Active users, Sessions, AET",
      },
      {
        label: "Event GA4 Export",
        desc: "Page path · Active users, Sessions, Event count (purchase)",
      },
    ],
  },
  {
    title: "Via Entry — second table",
    note: "/dijual/, /disewa/ and /articles-all/ only.",
    items: [
      {
        label: "Via Entry GA4 Export",
        desc: "Landing page + query string · Views, Active users, Sessions, AET",
      },
      {
        label: "Via Entry Event GA4 Export",
        desc: "Landing page + query string · Active users, Sessions, Event count",
      },
    ],
  },
  {
    title: "Shortcuts",
    note: "Fewer files for the same result.",
    items: [
      {
        label: "All-segments export",
        desc: "an unfiltered GA4 export is split by URL across every segment block",
      },
      {
        label: "/dijual/, /disewa/, Blog",
        desc: "GSC and GA4 are reused from Traffic (Optimized) — no upload",
      },
    ],
  },
];

function UploadGuide() {
  return (
    <div className="card p-4 space-y-3">
      <div>
        <div className="text-xs font-semibold text-ink mb-1">
          What to upload
        </div>
        <p className="text-xs text-muted">
          Upload fresh each month. Segments are detected from the URLs in the
          file, so the files can go in together in any order.
        </p>
      </div>
      {UPLOAD_GROUPS.map((group) => (
        <div key={group.title}>
          <div className="text-2xs uppercase tracking-wide text-muted mb-1">
            {group.title}
          </div>
          <p className="text-2xs text-muted mb-1.5">{group.note}</p>
          <ul className="space-y-1.5">
            {group.items.map((item) => (
              <li
                key={item.label}
                className="flex items-start gap-2 text-xs text-ink"
              >
                <span className="flex-shrink-0 text-muted">•</span>
                <span>
                  {item.label} <span className="text-muted">— {item.desc}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
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
      className={`border-2 border-dashed rounded-card transition-colors cursor-pointer select-none py-5 px-6 flex flex-col items-center text-center ${
        dragging
          ? "border-accent bg-accent-subtle"
          : "border-border hover:border-muted hover:bg-surface-2/40"
      }`}
    >
      {processing ? (
        <>
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin mb-2" />
          <div className="text-xs font-medium text-muted">
            Processing files…
          </div>
        </>
      ) : (
        <>
          <Upload size={16} className="text-muted mb-2" strokeWidth={1.5} />
          <div className="text-xs font-semibold text-ink mb-1">
            {dragging
              ? "Drop files here"
              : "Drag & drop Traffic Overview files"}
          </div>
          <p className="text-2xs text-muted mb-2">
            Original GSC or GA4 export, no restructure. Sheets auto-detected.
          </p>
          <span className="btn-secondary pointer-events-none text-2xs h-7 px-3">
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

// Counts for the most recent upload plus the log as a whole. The point is
// validation: dropping seventeen files and seeing sixteen processed should
// be obvious, and "submitted" carries the number actually handed over so a
// file rejected before it could be logged still shows up in the difference.
function summariseLog(log) {
  const counts = { ok: 0, warn: 0, error: 0, skip: 0 };
  for (const e of log) counts[e.status] = (counts[e.status] ?? 0) + 1;

  let latest = null;
  for (const e of log) {
    if (e.batch && (latest === null || e.batch > latest)) latest = e.batch;
  }
  const batchEntries = latest ? log.filter((e) => e.batch === latest) : [];
  const submitted = batchEntries[0]?.submitted ?? batchEntries.length;

  return {
    counts,
    total: log.length,
    lastProcessed: batchEntries.length,
    lastSubmitted: submitted,
    lastFailed: batchEntries.filter(
      (e) => e.status === "error" || e.status === "skip",
    ).length,
  };
}

function DetectionLog({ log, onClear }) {
  const s = summariseLog(log);
  const missing = s.lastSubmitted - s.lastProcessed;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className="text-xs font-semibold text-ink">Detection Log</h3>
          {log.length > 0 && (
            <span className="text-2xs text-muted">
              <strong className="text-ink">{s.lastSubmitted}</strong> file
              {s.lastSubmitted === 1 ? "" : "s"} last upload
              {missing > 0 && (
                <span className="text-danger"> · {missing} not processed</span>
              )}
              {s.lastFailed > 0 && (
                <span className="text-pending">
                  {" "}
                  · {s.lastFailed} skipped or failed
                </span>
              )}
              <span className="text-muted/70"> · {s.total} in log</span>
            </span>
          )}
        </div>
        <button
          onClick={onClear}
          className="text-xs text-muted hover:text-ink flex-shrink-0"
        >
          Clear
        </button>
      </div>
      {log.length > 0 && (
        <div className="flex items-center gap-3 text-2xs mb-3 pb-3 border-b border-border">
          <span className="text-ok">{s.counts.ok} detected</span>
          {s.counts.warn > 0 && (
            <span className="text-pending">{s.counts.warn} warning</span>
          )}
          {s.counts.error > 0 && (
            <span className="text-danger">{s.counts.error} error</span>
          )}
          {s.counts.skip > 0 && (
            <span className="text-empty">{s.counts.skip} skipped</span>
          )}
        </div>
      )}
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

// Flow 1 already imports GSC and GA4 for these three segments, so Flow 2
// reuses those documents instead of asking for the same file twice. Every
// other segment is uploaded here.
const FLOW1_GSC_PREFIX = {
  dijual: "bc_gsc_dijual",
  disewa: "bc_gsc_disewa",
  blog: "blog_gsc",
};
const FLOW1_GA4_PREFIX = {
  dijual: "bc_ga4_dijual",
  disewa: "bc_ga4_disewa",
  blog: "blog_ga4",
};

// One row per file the sheet can take. `prefix` is where the row's data lives;
// `flow2Prefix` is the key a direct upload writes to, so a reuse row still
// reads as filled (and stays clearable) when it was uploaded here instead.
function buildSlotRows() {
  const rows = [];

  for (const seg of SEGMENTS) {
    const flow1 = FLOW1_GSC_PREFIX[seg.id];
    rows.push({
      id: `gsc_${seg.id}`,
      source: "GSC Export",
      segment: seg.short,
      store: flow1 ? "flow1" : "flow2",
      prefix: flow1 ?? `gsc_${seg.id}`,
      flow2Prefix: flow1 ? `gsc_${seg.id}` : null,
      subtitle: flow1 ? "reuse / manual upload" : null,
    });
  }

  for (const seg of SEGMENTS) {
    const flow1 = FLOW1_GA4_PREFIX[seg.id];
    rows.push({
      id: `ga4_${seg.id}`,
      source: "GA4 Export",
      segment: seg.short,
      store: flow1 ? "flow1" : "flow2",
      prefix:
        flow1 ?? (seg.id === "all_organic" ? "ga4_free" : `ga4_${seg.id}`),
      flow2Prefix: flow1 ? `ga4_${seg.id}` : null,
      subtitle: flow1 ? "reuse / manual upload" : null,
    });
  }

  for (const seg of SEGMENTS) {
    rows.push({
      id: `ga4_leads_${seg.id}`,
      source: "Event GA4 Export",
      segment: seg.short,
      store: "flow2",
      prefix: seg.id === "all_organic" ? "ga4_leads" : `ga4_leads_${seg.id}`,
      subtitle: "purchase",
    });
  }

  for (const entry of ENTRY_SEGMENTS) {
    rows.push({
      id: entry.id,
      source: "Via Entry GA4 Export",
      segment: SEGMENTS.find((x) => x.id === entry.base).short,
      store: "flow2",
      prefix: `ga4_entry_${entry.base}`,
      subtitle: "landing page",
    });
  }

  for (const entry of ENTRY_SEGMENTS) {
    rows.push({
      id: `${entry.id}_leads`,
      source: "Via Entry Event GA4 Export",
      segment: SEGMENTS.find((x) => x.id === entry.base).short,
      store: "flow2",
      prefix: `ga4_entry_leads_${entry.base}`,
      subtitle: "landing page · purchase",
    });
  }

  return rows;
}

const SLOT_ROWS_F2 = buildSlotRows();

function SlotGrid({ slots, flow1Data, flow2Data, onClear, clearingKey }) {
  let dataRowCount = 0;
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
              const primaryStore =
                row.store === "flow1" ? flow1Data : flow2Data;
              // A rule above the first row of each export type — thirty-six
              // rows read as one undifferentiated block otherwise.
              const startsGroup =
                ri > 0 && SLOT_ROWS_F2[ri - 1].source !== row.source;
              return (
                <tr
                  key={row.id}
                  className={`${idx % 2 === 1 ? "bg-surface-2/40" : ""} ${
                    startsGroup ? "border-t-2 border-border" : ""
                  }`}
                >
                  <td className="py-2.5 pr-4">
                    <div className="text-ink text-xs">{row.source}</div>
                    {row.subtitle && (
                      <div className="text-2xs text-muted">{row.subtitle}</div>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-muted text-2xs whitespace-nowrap">
                    {row.segment}
                  </td>
                  {slots.map((s) => {
                    const primaryKey = `${row.prefix}_${s.key}`;
                    const flow2Key = row.flow2Prefix
                      ? `${row.flow2Prefix}_${s.key}`
                      : null;
                    const primaryEntry = primaryStore[primaryKey];
                    const flow2Entry = flow2Key ? flow2Data[flow2Key] : null;
                    const primaryFilled = !!primaryEntry;
                    const flow2Filled = !!flow2Entry;
                    const filled = primaryFilled || flow2Filled;
                    // Allow clearing: flow2 direct upload always clearable;
                    // for reuse rows, clear the flow2 override if that's what filled it.
                    const clearKey =
                      row.store === "flow2"
                        ? primaryKey
                        : flow2Filled
                          ? flow2Key
                          : null;
                    // Only flag flow1 reuse entries that lack BOTH the new exact-aggregate
                    // fields AND url-level rows — meaning no usable data at all.
                    // flow2 direct-upload rows (store:"flow2") are never stale: their
                    // entries store already-aggregated values in a different shape.
                    // flow1 entries with rows use the url-row fallback, which is fine.
                    const isStale =
                      filled &&
                      row.store === "flow1" &&
                      !flow2Filled &&
                      ((row.source.includes("GSC") &&
                        primaryEntry &&
                        !primaryEntry.chartAgg &&
                        !Array.isArray(primaryEntry.rows)) ||
                        (row.source.includes("GA4") &&
                          primaryEntry &&
                          !primaryEntry.grandTotal &&
                          !Array.isArray(primaryEntry.rows)));
                    return (
                      <td key={s.key} className="py-2.5 px-2 text-center">
                        <SlotDot
                          filled={filled}
                          stale={isStale}
                          onClear={clearKey ? () => onClear(clearKey) : null}
                          clearing={!!clearKey && clearingKey === clearKey}
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

function SlotDot({ filled, stale, onClear, clearing }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="inline-flex items-center gap-1"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span
        className={`${filled ? "dot-ok" : "dot-empty"} text-sm`}
        title={
          stale
            ? "Re-upload to Flow 1 to get exact position/AET values"
            : undefined
        }
      >
        {stale ? "◑" : "●"}
      </span>
      {(hover || clearing) && filled && onClear && (
        <button
          onClick={onClear}
          disabled={clearing}
          className="text-muted hover:text-danger transition-colors disabled:opacity-40"
          title={clearing ? "Clearing…" : undefined}
        >
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
  activeSeg,
  setActiveSeg,
}) {
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
        <div className="px-4 pt-3 pb-2.5 border-b border-border space-y-2 overflow-x-auto">
          <SegmentTabs
            segments={SEGMENTS.map((seg) => ({ id: seg.id, label: seg.short }))}
            activeSeg={activeSeg}
            setActiveSeg={setActiveSeg}
          />
          <div className="flex items-center gap-2">
            <span className="text-2xs uppercase tracking-wide text-muted flex-shrink-0">
              Via Entry
            </span>
            <SegmentTabs
              segments={ENTRY_SEGMENTS.map((entry) => ({
                id: entry.id,
                label: SEGMENTS.find((x) => x.id === entry.base).short,
              }))}
              activeSeg={activeSeg}
              setActiveSeg={setActiveSeg}
            />
          </div>
        </div>
        <SegmentTable segId={activeSeg} output={output} slots={slots} />
      </div>
    </div>
  );
}

function SegmentTabs({ segments, activeSeg, setActiveSeg }) {
  return (
    <div className="inline-flex bg-surface-2 rounded-[6px] p-0.5 gap-0.5">
      {segments.map((seg) => (
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
  );
}

function SegmentTable({ segId, output, slots }) {
  const segData = output[segId] ?? {};
  // The Via Entry table has no GSC export behind it, so it shows the GA4 rows
  // only — the same nine rows the sheet gives it.
  const metrics = ENTRY_SEGMENTS.some((e) => e.id === segId)
    ? ENTRY_METRICS
    : METRICS;

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
          {metrics.map((metric, mi) => (
            <tr
              key={metric.id}
              className={`hover:bg-surface-2/50 ${mi % 2 === 1 ? "bg-surface-2/25" : ""}`}
            >
              <td className="py-2.5 px-4 text-ink text-xs sticky left-0 bg-surface">
                {metric.label}
              </td>
              {slots.map((s) => {
                const val = segData[s.key]?.[metric.id];
                const text = formatMetricValue(metric.id, val);
                return (
                  <td
                    key={s.key}
                    className={`py-2.5 px-3 text-center tabular-nums ${text ? "text-ink" : "text-empty"}`}
                  >
                    {text || "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
