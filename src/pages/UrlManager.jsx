import { useState, useRef } from 'react'
import Papa from 'papaparse'
import { useStorage } from '../hooks/useStorage'
import { usePagination } from '../hooks/usePagination'
import { urlToSlug } from '../utils/dateUtils'
import { getValidToken } from '../utils/googleAuth'
import PaginationControls from '../components/PaginationControls'

const TABS = [
  { id: 'bc', label: 'BC (Bottom Content)' },
  { id: 'blog', label: 'Blog (Articles)' },
]

// Column definitions per project
const BC_COLS = [
  { key: 'main_keyword', label: 'Main Keyword', type: 'text', width: 'w-40' },
  { key: 'offer', label: 'Offer', type: 'select', options: ['dijual/', 'disewa/'], width: 'w-28' },
  { key: 'property', label: 'Property', type: 'text', width: 'w-28' },
  { key: 'url', label: 'URL', type: 'url', width: 'w-64' },
  { key: 'publish', label: 'Publish', type: 'date', width: 'w-32' },
  { key: 'status', label: 'Status', type: 'text', width: 'w-36' },
  { key: 'pic', label: 'PIC', type: 'text', width: 'w-28' },
  { key: 'slug', label: 'Slug', type: 'readonly', width: 'w-48' },
]

const BLOG_COLS = [
  { key: 'keyword', label: 'Keyword', type: 'text', width: 'w-44' },
  { key: 'url', label: 'URL', type: 'url', width: 'w-64' },
  { key: 'status', label: 'Status', type: 'text', width: 'w-28' },
  { key: 'publish_date', label: 'Publish Date', type: 'date', width: 'w-32' },
  { key: 'content_type', label: 'Content Type', type: 'select', options: ['Create', 'Optimize', 'Update'], width: 'w-28' },
  { key: 'pic', label: 'PIC', type: 'text', width: 'w-28' },
  { key: 'slug', label: 'Slug', type: 'readonly', width: 'w-48' },
]

function emptyRow(type) {
  if (type === 'bc') {
    return { id: crypto.randomUUID(), main_keyword: '', offer: 'dijual/', property: '', url: '', publish: '', status: '', pic: '', slug: '' }
  }
  return { id: crypto.randomUUID(), keyword: '', url: '', status: '', publish_date: '', content_type: 'Create', pic: '', slug: '' }
}

function withSlug(row) {
  return { ...row, slug: urlToSlug(row.url || '') }
}

export default function UrlManager() {
  const [activeTab, setActiveTab] = useState('bc')
  const [bcUrls, setBcUrls] = useStorage('bc_urls', [])
  const [blogUrls, setBlogUrls] = useStorage('blog_urls', [])

  const urls = activeTab === 'bc' ? bcUrls : blogUrls
  const setUrls = activeTab === 'bc' ? setBcUrls : setBlogUrls
  const cols = activeTab === 'bc' ? BC_COLS : BLOG_COLS
  const pagination = usePagination(urls, 100)

  function handleAddRow() {
    setUrls(prev => [...prev, emptyRow(activeTab)])
  }

  function handleUpdateRow(id, field, value) {
    setUrls(prev =>
      prev.map(row => {
        if (row.id !== id) return row
        const updated = { ...row, [field]: value }
        if (field === 'url') updated.slug = urlToSlug(value)
        return updated
      })
    )
  }

  function handleDeleteRow(id) {
    setUrls(prev => prev.filter(r => r.id !== id))
  }

  function handleClearAll() {
    if (confirm(`Clear all ${activeTab.toUpperCase()} URLs? This cannot be undone.`)) {
      setUrls([])
    }
  }

  function handleExportCSV() {
    const cols = activeTab === 'bc' ? BC_COLS : BLOG_COLS
    const headers = cols.filter(c => c.type !== 'readonly').map(c => c.label).concat('Slug')
    const rows = urls.map(row =>
      cols.filter(c => c.type !== 'readonly').map(c => row[c.key] ?? '').concat(row.slug ?? '')
    )
    const csv = [headers, ...rows]
      .map(r => r.map(c => {
        const s = String(c ?? '')
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
      }).join(','))
      .join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${activeTab}_urls.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-brand-500 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-200'
            }`}
          >
            {tab.label}
            <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
              activeTab === tab.id ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-600'
            }`}>
              {activeTab === tab.id ? urls.length : (tab.id === 'bc' ? bcUrls.length : blogUrls.length)}
            </span>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="card p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={handleAddRow} className="btn-primary">
            + Add Row
          </button>
          <span className="w-px h-6 bg-gray-200 mx-1" />
          <CsvImportButton
            type={activeTab}
            cols={cols}
            onImport={(rows) => setUrls(prev => [...prev, ...rows])}
            onReplace={(rows) => setUrls(rows)}
          />
          <SheetsImportButton
            type={activeTab}
            cols={cols}
            onImport={(rows) => setUrls(prev => [...prev, ...rows])}
            onReplace={(rows) => setUrls(rows)}
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 font-medium">{urls.length} rows</span>
          {urls.length > 0 && (
            <>
              <button onClick={handleExportCSV} className="btn-ghost text-xs text-gray-500">
                ⬇ Export CSV
              </button>
              <button onClick={handleClearAll} className="btn-ghost text-red-600 hover:bg-red-50 text-xs">
                Clear all
              </button>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      {urls.length === 0 ? (
        <EmptyState type={activeTab} onAdd={handleAddRow} />
      ) : (
        <>
          <UrlTable
            rows={pagination.pageItems}
            cols={cols}
            onUpdate={handleUpdateRow}
            onDelete={handleDeleteRow}
            startIndex={pagination.pageSize === 'all' ? 0 : (pagination.page - 1) * pagination.pageSize}
          />
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
        </>
      )}
    </div>
  )
}

// ─── Table ────────────────────────────────────────────────────────────────────

// Rows render as plain text by default and only mount live <input>/<select>
// elements for the one row being edited. With thousands of imported rows,
// always-live inputs meant tens of thousands of interactive DOM nodes
// mounted at once — this cuts that down to a handful.
function UrlTable({ rows, cols, onUpdate, onDelete, startIndex = 0 }) {
  const [editingId, setEditingId] = useState(null)

  return (
    <div className="card overflow-x-auto">
      <table className="text-sm w-full">
        <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
          <tr>
            <th className="text-left py-3 px-3 text-gray-500 font-medium w-8">#</th>
            {cols.map(col => (
              <th key={col.key} className={`text-left py-3 px-2 text-gray-500 font-medium uppercase tracking-wide text-[11px] ${col.width}`}>
                {col.label}
              </th>
            ))}
            <th className="py-3 px-3 w-10" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
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
  )
}

function TableRow({ row, index, cols, onUpdate, onDelete, editing, onStartEdit, onStopEdit }) {
  return (
    <tr
      className={`group transition-colors ${editing ? 'bg-brand-50/60' : 'even:bg-gray-50/40 hover:bg-brand-50/60 cursor-text'}`}
      onClick={() => { if (!editing) onStartEdit() }}
      onBlur={(e) => { if (editing && !e.currentTarget.contains(e.relatedTarget)) onStopEdit() }}
      title={editing ? '' : 'Click to edit this row'}
    >
      <td className="py-2 px-3 text-gray-400 text-xs">{index}</td>
      {cols.map(col => (
        <td key={col.key} className="py-1.5 px-2">
          {editing || col.type === 'readonly' ? (
            <CellInput
              col={col}
              value={row[col.key] ?? ''}
              onChange={(val) => onUpdate(row.id, col.key, val)}
            />
          ) : (
            <ReadOnlyCell value={row[col.key]} />
          )}
        </td>
      ))}
      <td className="py-2 px-3">
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(row.id) }}
          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all"
          title="Delete row"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </td>
    </tr>
  )
}

function ReadOnlyCell({ value }) {
  return (
    <span className="text-sm text-gray-700 truncate block max-w-[200px]" title={value || undefined}>
      {value || <span className="text-gray-300">—</span>}
    </span>
  )
}

// <input type="date"> only accepts YYYY-MM-DD; imported dates like "3 Oct
// 2025" render blank otherwise, even though the underlying value is intact.
function toISODate(value) {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function CellInput({ col, value, onChange }) {
  if (col.type === 'readonly') {
    return (
      <span className="text-xs text-gray-400 font-mono truncate block max-w-[180px]" title={value}>
        {value || '—'}
      </span>
    )
  }
  if (col.type === 'select') {
    return (
      <select
        className="text-sm border border-transparent hover:border-gray-300 focus:border-brand-500 rounded px-1 py-0.5 bg-transparent focus:bg-white focus:outline-none w-full"
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        {col.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  if (col.type === 'date') {
    return (
      <input
        type="date"
        className="text-sm border border-transparent hover:border-gray-300 focus:border-brand-500 rounded px-1 py-0.5 bg-transparent focus:bg-white focus:outline-none"
        value={toISODate(value)}
        onChange={e => onChange(e.target.value)}
      />
    )
  }
  return (
    <input
      type="text"
      className="text-sm border border-transparent hover:border-gray-300 focus:border-brand-500 rounded px-1 py-0.5 bg-transparent focus:bg-white focus:outline-none w-full min-w-[80px]"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={col.label}
    />
  )
}

// ─── CSV Import ───────────────────────────────────────────────────────────────

function CsvImportButton({ type, cols, onImport, onReplace }) {
  const fileRef = useRef()
  const [mode, setMode] = useState('append')
  const [loading, setLoading] = useState(false)

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''
    setLoading(true)

    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: ({ data }) => {
        const headerIdx = locateHeaderRow(data)
        const rows = rowsToObjects(data, headerIdx).map(raw => parseImportedRow(raw, type, cols))
        if (mode === 'replace') {
          if (confirm(`Replace all existing ${type.toUpperCase()} URLs with ${rows.length} imported rows?`)) {
            onReplace(rows)
          }
        } else {
          onImport(rows)
        }
        setLoading(false)
      },
      error: (err) => { setLoading(false); alert(`CSV parse error: ${err.message}`) },
    })
  }

  return (
    <div className="flex items-center gap-1.5">
      <button onClick={() => fileRef.current.click()} disabled={loading} className="btn-secondary disabled:opacity-50">
        {loading ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            Importing…
          </span>
        ) : '⬆ Import CSV'}
      </button>
      <select
        className="text-xs border border-gray-300 rounded-lg px-2 py-2 bg-white text-gray-600 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
        value={mode}
        onChange={e => setMode(e.target.value)}
        title="Import mode"
      >
        <option value="append">Append</option>
        <option value="replace">Replace</option>
      </select>
      <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
    </div>
  )
}

// ─── Google Sheets Import ──────────────────────────────────────────────────────

function SheetsImportButton({ type, cols, onImport, onReplace }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleImport(mode) {
    setError(null)
    const sheetId = extractSheetId(url)
    if (!sheetId) {
      setError('Could not parse spreadsheet ID from URL.')
      return
    }

    const token = await getValidToken()
    if (!token) {
      setError('Not connected to Google. Go to Settings → Connect Google first.')
      return
    }
    setLoading(true)
    try {
      // Resolve which tab the link actually points to (gid), so a link to
      // the 2nd/3rd tab doesn't silently fall back to the 1st tab. Range is
      // open-ended ("A:Z" not "A1:Z5000") so sheets with more than 5000 rows
      // aren't silently truncated.
      let range = 'A:Z'
      const gid = extractGid(url)
      if (gid) {
        const metaRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties(sheetId,title)`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        const meta = await metaRes.json()
        if (meta.error) throw new Error(meta.error.message)
        const sheet = (meta.sheets || []).find(s => String(s.properties.sheetId) === gid)
        if (sheet) range = `'${sheet.properties.title}'!A:Z`
      }

      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const data = await res.json()
      if (data.error) throw new Error(data.error.message)

      const values = data.values || []
      if (values.length === 0) throw new Error('Sheet appears empty.')

      const headerIdx = locateHeaderRow(values)
      const rows = rowsToObjects(values, headerIdx).map(raw => parseImportedRow(raw, type, cols))

      if (mode === 'replace') {
        if (confirm(`Replace all existing ${type.toUpperCase()} URLs with ${rows.length} imported rows?`)) {
          onReplace(rows)
        }
      } else {
        onImport(rows)
      }
      setOpen(false)
      setUrl('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-secondary">
        🔗 From Sheets
      </button>
    )
  }

  return (
    <div className="flex items-start gap-2 p-3.5 bg-gray-50 border border-gray-200 rounded-xl shadow-sm">
      <div className="flex-1 space-y-2">
        <input
          type="url"
          className="input text-sm"
          placeholder="https://docs.google.com/spreadsheets/d/...#gid=..."
          value={url}
          onChange={e => setUrl(e.target.value)}
          autoFocus
        />
        <p className="text-xs text-gray-500">
          Paste the link to the exact tab you want (its <code>gid</code> is detected automatically). The sheet must be shared with <strong>"Anyone with the link can view"</strong> access.
        </p>
        {error && <div className="text-xs text-red-600">{error}</div>}
        <div className="flex gap-2">
          <button
            onClick={() => handleImport('append')}
            disabled={!url || loading}
            className="btn-primary text-xs py-1.5 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Append'}
          </button>
          <button
            onClick={() => handleImport('replace')}
            disabled={!url || loading}
            className="btn-secondary text-xs py-1.5 disabled:opacity-50"
          >
            Replace all
          </button>
          <button onClick={() => { setOpen(false); setError(null) }} className="btn-ghost text-xs py-1.5">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function EmptyState({ type, onAdd }) {
  return (
    <div className="card p-12 flex flex-col items-center text-center border-dashed border-2 border-gray-200 bg-gray-50/50">
      <div className="text-4xl mb-3">📋</div>
      <div className="font-semibold text-gray-800 mb-1">No {type.toUpperCase()} URLs yet</div>
      <div className="text-sm text-gray-500 mb-4">
        Add rows manually, import a CSV, or pull from a Google Sheet.
      </div>
      <button onClick={onAdd} className="btn-primary">+ Add first row</button>
    </div>
  )
}

function extractSheetId(url) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

function extractGid(url) {
  const m = url.match(/[#&?]gid=(\d+)/)
  return m ? m[1] : null
}

// Known column labels (lowercased) across BC_COLS/BLOG_COLS, used to find the
// real header row when the source has banner/notice rows above it (common in
// Sheets exports, e.g. "⚠️ Do not change anything...").
const HEADER_HINTS = [
  'main keyword', 'keyword', 'offer', 'property', 'url', 'publish', 'publish date',
  'status', 'content type', 'pic', 'slug',
]

function locateHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = (rows[i] || []).map(c => String(c ?? '').trim().toLowerCase())
    const hits = cells.filter(c => HEADER_HINTS.includes(c)).length
    if (hits >= 2) return i
  }
  return 0
}

function rowsToObjects(rows, headerIdx) {
  const headers = rows[headerIdx] || []
  return rows.slice(headerIdx + 1)
    .filter(r => r.some(c => String(c ?? '').trim() !== ''))
    .map(r => {
      const obj = {}
      headers.forEach((h, i) => { if (h) obj[h] = r[i] ?? '' })
      return obj
    })
}

/**
 * Map a raw imported row (keyed by CSV/Sheet headers) to our internal schema.
 * Tries both exact header names and case-insensitive fuzzy match.
 */
function parseImportedRow(raw, type, cols) {
  // Build case-insensitive lookup
  const lowerRaw = {}
  Object.entries(raw).forEach(([k, v]) => { lowerRaw[k.toLowerCase().trim()] = v })

  function get(...aliases) {
    for (const alias of aliases) {
      const v = raw[alias] ?? lowerRaw[alias.toLowerCase()]
      if (v !== undefined && v !== '') return v
    }
    return ''
  }

  let row
  if (type === 'bc') {
    row = {
      id: crypto.randomUUID(),
      main_keyword: get('Main Keyword', 'main_keyword', 'keyword'),
      offer: get('Offer', 'offer'),
      property: get('Property', 'property'),
      url: get('URL', 'url', 'Url'),
      publish: get('Publish', 'publish', 'Publish Date', 'publish_date'),
      status: get('Status', 'status'),
      pic: get('PIC', 'pic'),
      slug: '',
    }
  } else {
    row = {
      id: crypto.randomUUID(),
      keyword: get('Keyword', 'keyword', 'Main Keyword', 'main_keyword'),
      url: get('URL', 'url', 'Url'),
      status: get('Status', 'status'),
      publish_date: get('Publish Date', 'publish_date', 'Publish', 'publish'),
      content_type: get('Content Type', 'content_type', 'ContentType'),
      pic: get('PIC', 'pic'),
      slug: '',
    }
  }

  row.slug = urlToSlug(row.url)
  return row
}
