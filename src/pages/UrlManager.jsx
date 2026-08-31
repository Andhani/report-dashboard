import { useState, useRef, useMemo, useLayoutEffect } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Upload } from "lucide-react";
import {
  useCloudStorage as useStorage,
  useCloudArrayStorage,
} from "../hooks/useCloudStorage";
import {
  describeWriteError,
  useCloudData,
} from "../context/CloudDataContext";
import { usePagination } from "../hooks/usePagination";
import { urlToSlug } from "../utils/dateUtils";
import { getValidToken } from "../utils/googleAuth";
import PaginationControls from "../components/PaginationControls";

const TABS = [
  { id: "bc", label: "BC (Bottom Content)" },
  { id: "blog", label: "Blog (Articles)" },
];

// Column definitions per project
const BC_COLS = [
  { key: "main_keyword", label: "Main Keyword", type: "text", width: "w-40" },
  {
    key: "offer",
    label: "Offer",
    type: "select",
    options: ["dijual/", "disewa/"],
    width: "w-28",
  },
  { key: "property", label: "Property", type: "text", width: "w-28" },
  { key: "url", label: "URL", type: "url", width: "w-64" },
  { key: "publish", label: "Publish", type: "date", width: "w-32" },
  { key: "status", label: "Status", type: "text", width: "w-36" },
  { key: "pic", label: "PIC", type: "text", width: "w-28" },
  { key: "slug", label: "Slug", type: "readonly", width: "w-48" },
];

const BLOG_COLS = [
  { key: "keyword", label: "Keyword", type: "text", width: "w-44" },
  { key: "url", label: "URL", type: "url", width: "w-64" },
  { key: "status", label: "Status", type: "text", width: "w-28" },
  { key: "publish_date", label: "Publish Date", type: "date", width: "w-32" },
  {
    key: "content_type",
    label: "Content Type",
    type: "select",
    options: ["Create", "Optimize", "Update"],
    width: "w-28",
  },
  { key: "pic", label: "PIC", type: "text", width: "w-28" },
  { key: "slug", label: "Slug", type: "readonly", width: "w-48" },
];

function emptyRow(type) {
  if (type === "bc") {
    return {
      id: crypto.randomUUID(),
      main_keyword: "",
      offer: "dijual/",
      property: "",
      url: "",
      publish: "",
      status: "",
      pic: "",
      slug: "",
    };
  }
  return {
    id: crypto.randomUUID(),
    keyword: "",
    url: "",
    status: "",
    publish_date: "",
    content_type: "Create",
    pic: "",
    slug: "",
  };
}

function withSlug(row) {
  return { ...row, slug: urlToSlug(row.url || "") };
}

export default function UrlManager() {
  const [activeTab, setActiveTab] = useStorage("urls_active_tab", "bc");
  const [bcUrls, setBcUrls] = useCloudArrayStorage("bc_urls", []);
  const [blogUrls, setBlogUrls] = useCloudArrayStorage("blog_urls", []);
  const { clearArrayKey, writeErrors } = useCloudData();

  // Import toolbar state
  const [importMode, setImportMode] = useStorage("urls_import_mode", "sheets");
  // Written synchronously: the debounced default could lose the cleared
  // value to a reload, so a consumed URL would reappear in the field.
  const [importSheetUrl, setImportSheetUrl] = useStorage(
    "urls_import_sheet_url",
    "",
    { sync: true },
  );
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const csvRef = useRef();

  // Saving thousands of rows is many batched round trips taking real
  // seconds. Without a visible in-progress state the page looks either
  // frozen or already finished, and a reload during it loses whichever
  // batches hadn't landed.
  const [saving, setSaving] = useState(null); // { label, done, total }
  const [saveNotice, setSaveNotice] = useState(null);

  // Column filters (Sheets/Excel-style), kept per tab since BC and Blog
  // share some column keys (url, status, pic, slug) but hold unrelated data.
  const [bcFilters, setBcFilters] = useState({});
  const [blogFilters, setBlogFilters] = useState({});

  const urls = activeTab === "bc" ? bcUrls : blogUrls;
  const setUrls = activeTab === "bc" ? setBcUrls : setBlogUrls;
  const cols = activeTab === "bc" ? BC_COLS : BLOG_COLS;
  const filters = activeTab === "bc" ? bcFilters : blogFilters;
  const setFilters = activeTab === "bc" ? setBcFilters : setBlogFilters;

  const filteredUrls = useMemo(
    () => applyColumnFilters(urls, filters),
    [urls, filters],
  );
  const activeFilterCount = Object.keys(filters).length;
  const pagination = usePagination(filteredUrls, 100);

  function handleAddRow() {
    setUrls((prev) => [...prev, emptyRow(activeTab)]);
  }

  function handleUpdateRow(id, field, value) {
    setUrls((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const updated = { ...row, [field]: value };
        if (field === "url") updated.slug = urlToSlug(value);
        return updated;
      }),
    );
  }

  // The delete is awaited rather than fired and forgotten: a rejected write
  // leaves the row in Firestore, so treating the removal as done is how a
  // deleted row was back after a reload with nothing said.
  async function handleDeleteRow(id) {
    setSaveNotice(null);
    const { ok, error } = await setUrls((prev) =>
      prev.filter((r) => r.id !== id),
    );
    if (!ok) setSaveNotice(`Couldn't delete that row. ${describeWriteError(error)}`);
  }

  async function handleClearAll() {
    if (
      !confirm(
        `Clear all ${activeTab.toUpperCase()} URLs? This cannot be undone.`,
      )
    ) {
      return;
    }
    const label = activeTab.toUpperCase();
    setSaveNotice(null);
    setSaving({ label: `Deleting ${label} URLs`, done: 0, total: 0 });
    try {
      await clearArrayKey(
        activeTab === "bc" ? "bc_urls" : "blog_urls",
        (done, total) =>
          setSaving({ label: `Deleting ${label} URLs`, done, total }),
      );
      setFilters({});
      // The source URL refers to a list that no longer exists, so leaving it
      // in the box just invites re-importing what was deliberately cleared.
      setImportSheetUrl("");
      setSaveNotice(`${label} URL list cleared.`);
    } catch (err) {
      setSaveNotice(`Couldn't finish clearing. ${describeWriteError(err)}`);
    } finally {
      setSaving(null);
    }
  }

  async function applyImport(rows) {
    if (
      !confirm(
        `Replace all existing ${activeTab.toUpperCase()} URLs with ${rows.length} imported rows?`,
      )
    ) {
      return false;
    }
    const label = activeTab.toUpperCase();
    setSaveNotice(null);
    setSaving({ label: `Saving ${label} URLs`, done: 0, total: rows.length });
    try {
      // Awaited: this is the write that was previously fire-and-forget, so
      // the list looked saved while batches were still committing.
      const { ok, error } = await setUrls(rows, {
        onProgress: (done, total) =>
          setSaving({ label: `Saving ${label} URLs`, done, total }),
      });
      if (!ok) {
        setSaveNotice(`Save failed. ${describeWriteError(error)}`);
        return false;
      }
      setFilters({});
      setSaveNotice(`Saved ${rows.length.toLocaleString()} ${label} URLs.`);
      return true;
    } finally {
      setSaving(null);
    }
  }

  async function handleSheetImport() {
    setSheetError(null);
    const sheetId = extractSheetId(importSheetUrl);
    if (!sheetId) {
      setSheetError("Could not parse spreadsheet ID from URL.");
      return;
    }
    const token = await getValidToken();
    if (!token) {
      setSheetError(
        "Not connected to Google. Go to Settings → Connect Google first.",
      );
      return;
    }
    setSheetLoading(true);
    try {
      let range = "A:Z";
      const gid = extractGid(importSheetUrl);
      if (gid) {
        const metaRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties(sheetId,title)`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const meta = await metaRes.json();
        if (meta.error) throw new Error(meta.error.message);
        const sheet = (meta.sheets || []).find(
          (s) => String(s.properties.sheetId) === gid,
        );
        if (sheet) range = `'${sheet.properties.title}'!A:Z`;
      }
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const values = data.values || [];
      if (values.length === 0) throw new Error("Sheet appears empty.");
      const headerIdx = locateHeaderRow(values);
      const rows = rowsToObjects(values, headerIdx).map((raw, i) =>
        parseImportedRow(raw, activeTab, cols, i),
      );
      // Cleared only once the rows are actually saved — clearing on the way
      // in wiped the field even when the confirm was cancelled or the save
      // failed, and a debounced write of the empty value could be lost to a
      // reload, bringing the old URL back.
      if (await applyImport(rows)) setImportSheetUrl("");
    } catch (err) {
      setSheetError(err.message);
    } finally {
      setSheetLoading(false);
    }
  }

  async function handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    setCsvLoading(true);
    try {
      if (file.name.toLowerCase().endsWith(".xlsx")) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        const headerIdx = locateHeaderRow(data);
        const rows = rowsToObjects(data, headerIdx).map((raw, i) =>
          parseImportedRow(raw, activeTab, cols, i),
        );
        await applyImport(rows);
      } else {
        await new Promise((resolve, reject) => {
          Papa.parse(file, {
            header: false,
            skipEmptyLines: true,
            complete: ({ data }) => {
              const headerIdx = locateHeaderRow(data);
              const rows = rowsToObjects(data, headerIdx).map((raw, i) =>
                parseImportedRow(raw, activeTab, cols, i),
              );
              applyImport(rows).then(resolve, reject);
            },
            error: (err) => reject(err),
          });
        });
      }
    } catch (err) {
      alert(`Import error: ${err.message}`);
    } finally {
      setCsvLoading(false);
    }
  }

  function handleExportCSV() {
    const cols = activeTab === "bc" ? BC_COLS : BLOG_COLS;
    const headers = cols
      .filter((c) => c.type !== "readonly")
      .map((c) => c.label)
      .concat("Slug");
    const rows = urls.map((row) =>
      cols
        .filter((c) => c.type !== "readonly")
        .map((c) => row[c.key] ?? "")
        .concat(row.slug ?? ""),
    );
    const csv = [headers, ...rows]
      .map((r) =>
        r
          .map((c) => {
            const s = String(c ?? "");
            return s.includes(",") || s.includes('"')
              ? `"${s.replace(/"/g, '""')}"`
              : s;
          })
          .join(","),
      )
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${activeTab}_urls.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="inline-flex bg-surface-2 rounded-btn p-1">
        {TABS.map((tab) => {
          const count = tab.id === "bc" ? bcUrls.length : blogUrls.length;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-btn text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-surface text-ink shadow-card"
                  : "text-muted hover:text-ink"
              }`}
            >
              {tab.label}
              <span
                className="ml-1.5 text-[10px] text-muted"
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Import mode toggle + panel */}
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
            onClick={() => setImportMode("csv")}
            className={`px-3 py-1 rounded-[5px] text-xs font-medium transition-all ${
              importMode === "csv"
                ? "bg-surface text-ink shadow-card"
                : "text-muted hover:text-ink"
            }`}
          >
            Upload File
          </button>
        </div>

        {importMode === "sheets" && (
          <div className="card p-4 space-y-3">
            <input
              type="url"
              className="input"
              placeholder="https://docs.google.com/spreadsheets/d/...#gid=..."
              value={importSheetUrl}
              onChange={(e) => {
                setImportSheetUrl(e.target.value);
                setSheetError(null);
              }}
            />
            <p className="text-xs text-muted">
              Paste the link to the exact tab (its <code>gid</code> is detected
              automatically). The sheet must be shared with{" "}
              <strong>"Anyone with the link can view"</strong> access.
            </p>
            {sheetError && (
              <div className="text-xs text-danger">{sheetError}</div>
            )}
            <button
              onClick={handleSheetImport}
              disabled={!importSheetUrl || sheetLoading}
              className="btn-primary disabled:opacity-50"
            >
              {sheetLoading ? "Loading…" : "Import"}
            </button>
          </div>
        )}
        {importMode === "csv" && (
          <>
            <div
              onClick={() => !csvLoading && csvRef.current.click()}
              className="border-2 border-dashed rounded-card transition-colors cursor-pointer select-none py-5 px-6 flex flex-col items-center text-center border-border hover:border-muted hover:bg-surface-2/40"
            >
              {csvLoading ? (
                <>
                  <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin mb-2" />
                  <div className="text-xs font-medium text-muted">
                    Importing…
                  </div>
                </>
              ) : (
                <>
                  <Upload size={16} className="text-muted mb-2" strokeWidth={1.5} />
                  <div className="text-xs font-semibold text-ink mb-1">
                    Upload .csv or .xlsx
                  </div>
                  <div className="text-2xs text-muted mb-2">
                    Columns matched by header name
                  </div>
                  <span className="btn-secondary pointer-events-none text-2xs h-7 px-3">
                    Choose file
                  </span>
                </>
              )}
            </div>
            <input
              ref={csvRef}
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              onChange={handleFileImport}
            />
          </>
        )}
      </div>

      {/* Table actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-2xs text-muted">
          {urls.length > 0 &&
            (activeFilterCount > 0
              ? `${filteredUrls.length} of ${urls.length} rows`
              : `${urls.length} rows`)}
        </span>
        <div className="flex items-center gap-3">
          {urls.length > 0 && (
            <button
              onClick={handleExportCSV}
              className="btn-ghost text-muted"
            >
              ⬇ Export CSV
            </button>
          )}
          <button onClick={handleAddRow} className="btn-secondary">
            + Add Row
          </button>
          {urls.length > 0 && activeFilterCount > 0 && (
            <button
              onClick={() => setFilters({})}
              className="btn-ghost text-accent"
            >
              Clear filters ({activeFilterCount})
            </button>
          )}
          {urls.length > 0 && (
            <button
              onClick={handleClearAll}
              disabled={!!saving}
              className="btn-ghost text-danger hover:bg-danger/5 disabled:opacity-50"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {saving && (
        <div className="card p-4 border-accent/40">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
            <div className="text-xs font-medium text-ink">
              {saving.label}
              {saving.total > 0 && (
                <>
                  {" "}
                  — {saving.done.toLocaleString()} of{" "}
                  {saving.total.toLocaleString()}
                </>
              )}
            </div>
          </div>
          <div className="h-1.5 bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-200"
              style={{
                width: saving.total
                  ? `${Math.round((saving.done / saving.total) * 100)}%`
                  : "15%",
              }}
            />
          </div>
          <p className="text-2xs text-muted mt-2 leading-relaxed">
            Don't reload or close this tab until it finishes — rows still in
            flight wouldn't be saved.
          </p>
        </div>
      )}

      {/* A write the storage layer refused — including a load that could not
          re-shard a list migrated from the old flat format, which leaves the
          list unable to save until it succeeds. */}
      {!saving && writeErrors[activeTab === "bc" ? "bc_urls" : "blog_urls"] && (
        <div className="card p-3 border-warning/40 bg-warning/5">
          <span className="text-xs text-ink">
            {writeErrors[activeTab === "bc" ? "bc_urls" : "blog_urls"]}
          </span>
        </div>
      )}

      {saveNotice && !saving && (
        <div className="card p-3 flex items-center justify-between gap-3">
          <span className="text-xs text-ink">{saveNotice}</span>
          <button
            onClick={() => setSaveNotice(null)}
            className="btn-ghost text-2xs text-muted"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Table */}
      {urls.length === 0 ? (
        <EmptyState type={activeTab} onAdd={handleAddRow} />
      ) : (
        <>
          <UrlTable
            rows={pagination.pageItems}
            allRows={urls}
            cols={cols}
            filters={filters}
            onFilterChange={setFilters}
            onUpdate={handleUpdateRow}
            onDelete={handleDeleteRow}
            startIndex={
              pagination.pageSize === "all"
                ? 0
                : (pagination.page - 1) * pagination.pageSize
            }
          />
          {filteredUrls.length === 0 && (
            <div className="text-center text-xs text-muted py-6">
              No rows match the current filters.
            </div>
          )}
          <div className="mb-8">
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
        </>
      )}
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────

// Rows render as plain text by default and only mount live <input>/<select>
// elements for the one row being edited. With thousands of imported rows,
// always-live inputs meant tens of thousands of interactive DOM nodes
// mounted at once — this cuts that down to a handful.
function UrlTable({
  rows,
  allRows,
  cols,
  filters,
  onFilterChange,
  onUpdate,
  onDelete,
  startIndex = 0,
}) {
  const [editingId, setEditingId] = useState(null);
  const [openFilterKey, setOpenFilterKey] = useState(null);

  return (
    <div className="card overflow-x-auto">
      <table className="text-xs w-full">
        <thead className="bg-surface-2 border-b border-border sticky top-0 z-10">
          <tr>
            <th className="text-left py-3 px-3 text-muted font-medium w-8">
              #
            </th>
            {cols.map((col) => (
              <th
                key={col.key}
                className={`relative text-left py-3 px-2 text-muted font-medium uppercase tracking-wide text-xs ${col.width}`}
              >
                <div className="flex items-center gap-1">
                  <span className="truncate">{col.label}</span>
                  <ColumnFilter
                    col={col}
                    allRows={allRows}
                    activeValues={filters[col.key]}
                    open={openFilterKey === col.key}
                    onToggle={() =>
                      setOpenFilterKey((k) => (k === col.key ? null : col.key))
                    }
                    onClose={() => setOpenFilterKey(null)}
                    onApply={(values) => {
                      onFilterChange((prev) => {
                        const next = { ...prev };
                        if (values === null) {
                          delete next[col.key];
                        } else {
                          next[col.key] = values;
                        }
                        return next;
                      });
                      setOpenFilterKey(null);
                    }}
                  />
                </div>
              </th>
            ))}
            <th className="py-3 px-3 w-10" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, i) => (
            <TableRow
              key={row.id}
              row={row}
              index={startIndex + i + 1}
              cols={cols}
              onUpdate={onUpdate}
              onDelete={onDelete}
              editing={editingId === row.id}
              onStartEdit={() => setEditingId(row.id)}
              onStopEdit={() => setEditingId(null)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableRow({
  row,
  index,
  cols,
  onUpdate,
  onDelete,
  editing,
  onStartEdit,
  onStopEdit,
}) {
  return (
    <tr
      className={`group transition-colors ${editing ? "bg-accent/5" : "even:bg-surface-2/60 hover:bg-accent/5 cursor-text"}`}
      onClick={() => {
        if (!editing) onStartEdit();
      }}
      onBlur={(e) => {
        if (editing && !e.currentTarget.contains(e.relatedTarget)) onStopEdit();
      }}
      title={editing ? "" : "Click to edit this row"}
    >
      <td className="py-2 px-3 text-muted text-xs">{index}</td>
      {cols.map((col) => (
        <td key={col.key} className="py-1.5 px-2">
          {editing || col.type === "readonly" ? (
            <CellInput
              col={col}
              value={row[col.key] ?? ""}
              onChange={(val) => onUpdate(row.id, col.key, val)}
            />
          ) : (
            <ReadOnlyCell value={row[col.key]} />
          )}
        </td>
      ))}
      <td className="py-2 px-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(row.id);
          }}
          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-danger transition-all"
          title="Delete row"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </td>
    </tr>
  );
}

function ReadOnlyCell({ value }) {
  return (
    <span
      className="text-xs text-ink truncate block max-w-[200px]"
      title={value || undefined}
    >
      {value || <span className="text-muted">—</span>}
    </span>
  );
}

// Month name tables for normalizing imported dates (Indonesian + English)
const IMPORT_MONTH_ID = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
};
const IMPORT_MONTH_EN = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
  sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Normalize any common date string to YYYY-MM-DD for consistent storage
 * and reliable filtering downstream. Handles: ISO, DD/MM/YYYY, D MonthName YYYY,
 * MonthName YYYY (Indonesian + English), and native JS Date parsing.
 */
function normalizeImportedDate(value) {
  if (!value) return "";
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // YYYY-MM → treat as 1st of month
  let m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-01`;
  // DD/MM/YYYY or D/M/YYYY (Indonesian — day first)
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  // D MonthName YYYY e.g. "1 Juni 2026"
  m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const mo = IMPORT_MONTH_ID[m[2].toLowerCase()] ?? IMPORT_MONTH_EN[m[2].toLowerCase()];
    if (mo) return `${m[3]}-${String(mo).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  }
  // MonthName YYYY e.g. "Juni 2026"
  m = s.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const mo = IMPORT_MONTH_ID[m[1].toLowerCase()] ?? IMPORT_MONTH_EN[m[1].toLowerCase()];
    if (mo) return `${m[2]}-${String(mo).padStart(2, "0")}-01`;
  }
  // Native Date parsing as last resort
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return s;
}

// <input type="date"> only accepts YYYY-MM-DD; imported dates like "3 Oct
// 2025" render blank otherwise, even though the underlying value is intact.
function toISODate(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function CellInput({ col, value, onChange }) {
  if (col.type === "readonly") {
    return (
      <span
        className="text-2xs text-muted truncate block max-w-[180px]"
        title={value}
      >
        {value || "—"}
      </span>
    );
  }
  if (col.type === "select") {
    return (
      <select
        className="text-xs border border-transparent hover:border-border focus:border-accent rounded-btn px-1 py-0.5 bg-transparent focus:bg-surface focus:outline-none w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {col.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (col.type === "date") {
    return (
      <input
        type="date"
        className="text-xs border border-transparent hover:border-border focus:border-accent rounded-btn px-1 py-0.5 bg-transparent focus:bg-surface focus:outline-none"
        value={toISODate(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <input
      type="text"
      className="text-xs border border-transparent hover:border-border focus:border-accent rounded-btn px-1 py-0.5 bg-transparent focus:bg-surface focus:outline-none w-full min-w-[80px]"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={col.label}
    />
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function EmptyState({ type, onAdd }) {
  return (
    <div className="border-2 border-dashed border-border rounded-card py-12 px-8 flex flex-col items-center text-center">
      <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center text-accent mb-4">
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
          />
        </svg>
      </div>
      <div className="text-xs font-semibold text-ink mb-1">
        No {type.toUpperCase()} URLs yet
      </div>
      <div className="text-2xs text-muted mb-4">
        Add rows manually, import a CSV, or pull from a Google Sheet.
      </div>
      <button onClick={onAdd} className="btn-primary">
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 4.5v15m7.5-7.5h-15"
          />
        </svg>
        Add first row
      </button>
    </div>
  );
}

function extractSheetId(url) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function extractGid(url) {
  const m = url.match(/[#&?]gid=(\d+)/);
  return m ? m[1] : null;
}

// Known column labels (lowercased) across BC_COLS/BLOG_COLS, used to find the
// real header row when the source has banner/notice rows above it (common in
// Sheets exports, e.g. "⚠️ Do not change anything...").
const HEADER_HINTS = [
  "main keyword",
  "keyword",
  "offer",
  "property",
  "url",
  "publish",
  "published",
  "publish date",
  "status",
  "content type",
  "pic",
  "slug",
];

function locateHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = (rows[i] || []).map((c) =>
      String(c ?? "")
        .trim()
        .toLowerCase(),
    );
    const hits = cells.filter((c) => HEADER_HINTS.includes(c)).length;
    if (hits >= 2) return i;
  }
  return 0;
}

function rowsToObjects(rows, headerIdx) {
  const headers = rows[headerIdx] || [];
  return rows
    .slice(headerIdx + 1)
    .filter((r) => r.some((c) => String(c ?? "").trim() !== ""))
    .map((r) => {
      const obj = {};
      headers.forEach((h, i) => {
        if (h) obj[h] = r[i] ?? "";
      });
      return obj;
    });
}

/**
 * Map a raw imported row (keyed by CSV/Sheet headers) to our internal schema.
 * Tries both exact header names and case-insensitive fuzzy match.
 */
// Imported rows are keyed by position rather than a fresh uuid. Each row is
// its own Firestore document, so random ids meant re-importing a list wrote
// every new row AND deleted every old one — double the operations for what
// is usually largely the same data. Positional ids overwrite in place, so a
// re-import only writes, and only the rows whose contents actually differ.
function importedRowId(index) {
  return `row-${String(index).padStart(6, "0")}`;
}

function parseImportedRow(raw, type, cols, index) {
  // Build case-insensitive lookup
  const lowerRaw = {};
  Object.entries(raw).forEach(([k, v]) => {
    lowerRaw[k.toLowerCase().trim()] = v;
  });

  function get(...aliases) {
    for (const alias of aliases) {
      const v = raw[alias] ?? lowerRaw[alias.toLowerCase()];
      if (v !== undefined && v !== "") return v;
    }
    return "";
  }

  let row;
  if (type === "bc") {
    row = {
      id: importedRowId(index),
      main_keyword: get("Main Keyword", "main_keyword", "keyword"),
      offer: get("Offer", "offer"),
      property: get("Property", "property"),
      url: get("URL", "url", "Url"),
      publish: normalizeImportedDate(get("Published", "published", "Publish", "publish", "Publish Date", "publish_date")),
      status: get("Status", "status"),
      pic: get("PIC", "pic"),
      slug: "",
    };
  } else {
    row = {
      id: importedRowId(index),
      keyword: get("Keyword", "keyword", "Main Keyword", "main_keyword"),
      url: get("URL", "url", "Url"),
      status: get("Status", "status"),
      publish_date: normalizeImportedDate(get("Publish Date", "publish_date", "Publish", "publish")),
      content_type: get("Content Type", "content_type", "ContentType"),
      pic: get("PIC", "pic"),
      slug: "",
    };
  }

  row.slug = urlToSlug(row.url);
  return row;
}

// ─── Column filters (Sheets/Excel-style) ───────────────────────────────────────

const BLANK_VALUE = "";
const BLANK_LABEL = "(Blanks)";

function cellValue(row, key) {
  const v = row[key];
  return v === undefined || v === null ? "" : String(v);
}

// filters: { [colKey]: Set<string> } — a column present in the map keeps only
// rows whose value is in the set; a column absent from the map is unfiltered.
function applyColumnFilters(rows, filters) {
  const entries = Object.entries(filters);
  if (entries.length === 0) return rows;
  return rows.filter((row) =>
    entries.every(([key, values]) => values.has(cellValue(row, key))),
  );
}

function ColumnFilter({
  col,
  allRows,
  activeValues,
  open,
  onToggle,
  onClose,
  onApply,
}) {
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState(
    () => new Set(activeValues || []),
  );

  const counts = useMemo(() => {
    const map = new Map();
    allRows.forEach((row) => {
      const v = cellValue(row, col.key);
      map.set(v, (map.get(v) || 0) + 1);
    });
    return [...map.entries()].sort((a, b) => {
      if (a[0] === BLANK_VALUE) return -1;
      if (b[0] === BLANK_VALUE) return 1;
      return a[0].localeCompare(b[0]);
    });
  }, [allRows, col.key]);

  const allValues = useMemo(() => counts.map(([v]) => v), [counts]);

  // Reset the draft selection each time the popover opens.
  useLayoutEffect(() => {
    if (open) {
      setDraft(new Set(activeValues ? activeValues : allValues));
      setSearch("");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) {
    const isFiltered = activeValues && activeValues.size < allValues.length;
    return (
      <button
        onClick={onToggle}
        title="Filter"
        className={`shrink-0 p-0.5 rounded hover:bg-accent/10 ${isFiltered ? "text-accent" : "text-muted"}`}
      >
        <FilterIcon filled={isFiltered} />
      </button>
    );
  }

  const q = search.trim().toLowerCase();
  const visible = q
    ? counts.filter(([v]) =>
        (v === BLANK_VALUE ? BLANK_LABEL : v).toLowerCase().includes(q),
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
        <FilterIcon filled />
      </button>
      {/* Backdrop closes the popover on outside click */}
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div
        className="absolute left-0 top-full mt-1 z-30 w-60 bg-surface border border-border rounded-card shadow-card p-2 normal-case font-normal tracking-normal"
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
              <span className="truncate flex-1" title={v || BLANK_LABEL}>
                {v === BLANK_VALUE ? (
                  <span className="text-muted italic">{BLANK_LABEL}</span>
                ) : (
                  v
                )}
              </span>
              <span className="text-2xs text-muted shrink-0">{count}</span>
            </label>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 mt-1.5">
          <button
            className="btn-ghost text-2xs"
            onClick={onClose}
          >
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

function FilterIcon({ filled }) {
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
