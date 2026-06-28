import { useState, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useStorage } from '../hooks/useStorage'
import { getMonthSlots, formatMonthKey, secondsToHmmss, formatCTR } from '../utils/dateUtils'
import { parseFlow1File, getDataKey, formatDetectionLabel } from '../utils/parseFlow1'
import { computeFlow1Output, buildCSVData, buildSheetsValues } from '../utils/computeFlow1'
import { downloadCSV, readFileAsArrayBuffer } from '../utils/exportUtils'
import { pushFlow1ToSheets, extractSpreadsheetId } from '../utils/sheetsApi'

const PERIOD_LABEL = (slots) =>
  slots.length ? `${slots[0].label.replace(' ', '')}–${slots[slots.length - 1].label.replace(' ', '')}` : ''

export default function Flow1() {
  const [flow1Data, setFlow1Data] = useStorage('flow1_data', {})
  const [flow1Window] = useStorage('flow1_window', null)
  const [bcUrls] = useStorage('bc_urls', [])
  const [blogUrls] = useStorage('blog_urls', [])
  const [sheetsUrl] = useStorage('sheets_report_url', '')

  const [log, setLog] = useState([])
  const [processing, setProcessing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [previewTab, setPreviewTab] = useState('bc')
  const [pushStatus, setPushStatus] = useState({})
  const fileRef = useRef()

  const slots = flow1Window ? getMonthSlots(flow1Window, 6) : []
  const slotKeys = new Set(slots.map(s => s.key))

  // ─── File processing ────────────────────────────────────────────────────────

  async function processFiles(files) {
    setProcessing(true)
    const newEntries = {}
    const newLog = []

    for (const file of Array.from(files)) {
      if (!file.name.match(/\.(xlsx)$/i)) {
        newLog.push({ file: file.name, status: 'skip', message: 'Not an .xlsx file — skipped' })
        continue
      }
      try {
        const buf = await readFileAsArrayBuffer(file)
        const result = await parseFlow1File(buf)

        if (!result) {
          newLog.push({ file: file.name, status: 'error', message: 'Could not detect file type — check sheet names (Filters/Pages or Free-form 1)' })
          continue
        }

        const key = getDataKey(result)
        if (!key) {
          newLog.push({ file: file.name, status: 'warn', message: `Detected as ${result.type} but segment/project unknown — skipped` })
          continue
        }

        const monthKey = formatMonthKey(result.month.year, result.month.month)
        const inWindow = slotKeys.has(monthKey)

        newEntries[key] = { rows: result.rows, file: file.name }
        newLog.push({
          file: file.name,
          status: inWindow ? 'ok' : 'warn',
          message: formatDetectionLabel(result) + (inWindow ? '' : ' ⚠ outside current window'),
          key,
        })
      } catch (err) {
        newLog.push({ file: file.name, status: 'error', message: err.message })
      }
    }

    setFlow1Data(prev => ({ ...prev, ...newEntries }))
    setLog(prev => [...newLog, ...prev])
    setProcessing(false)
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length) processFiles(files)
  }

  function clearSlot(key) {
    setFlow1Data(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  // ─── Export ─────────────────────────────────────────────────────────────────

  function handleDownloadCSV(project) {
    const urlList = project === 'bc' ? bcUrls : blogUrls
    const output = computeFlow1Output(project, urlList, flow1Data, slots)
    const csv = buildCSVData(project, output, slots)
    const period = PERIOD_LABEL(slots)
    downloadCSV(csv, `${project === 'bc' ? 'BC' : 'Blog'}_Traffic_${period}.csv`)
  }

  async function handlePushSheets(project) {
    const ssId = extractSpreadsheetId(sheetsUrl)
    if (!ssId) {
      alert('No spreadsheet URL configured — add it in Settings.')
      return
    }
    setPushStatus(p => ({ ...p, [project]: 'pushing' }))
    try {
      const urlList = project === 'bc' ? bcUrls : blogUrls
      const output = computeFlow1Output(project, urlList, flow1Data, slots)
      const values = buildSheetsValues(output)
      await pushFlow1ToSheets(ssId, project, values)
      setPushStatus(p => ({ ...p, [project]: 'ok' }))
      setTimeout(() => setPushStatus(p => ({ ...p, [project]: null })), 4000)
    } catch (err) {
      setPushStatus(p => ({ ...p, [project]: 'error:' + err.message }))
    }
  }

  // ─── Slot state helpers ──────────────────────────────────────────────────────

  function slotStatus(row, slotKey) {
    if (row === 'bc_gsc') {
      const d = !!flow1Data[`bc_gsc_dijual_${slotKey}`]
      const s = !!flow1Data[`bc_gsc_disewa_${slotKey}`]
      if (d && s) return 'green'
      if (d || s) return 'yellow'
      return 'gray'
    }
    return flow1Data[`${row}_${slotKey}`] ? 'green' : 'gray'
  }

  function slotTooltip(row, slotKey) {
    if (row === 'bc_gsc') {
      const d = flow1Data[`bc_gsc_dijual_${slotKey}`]
      const s = flow1Data[`bc_gsc_disewa_${slotKey}`]
      const parts = []
      if (d) parts.push(`✓ dijual (${d.file})`)
      if (s) parts.push(`✓ disewa (${s.file})`)
      if (!d) parts.push('✗ dijual missing')
      if (!s) parts.push('✗ disewa missing')
      return parts.join('\n')
    }
    const entry = flow1Data[`${row}_${slotKey}`]
    return entry ? `✓ ${entry.file}` : 'Empty'
  }

  const anyData = Object.keys(flow1Data).length > 0
  const canExport = slots.length > 0

  // ─── Render ──────────────────────────────────────────────────────────────────

  if (!flow1Window) {
    return (
      <div className="card p-8 text-center max-w-lg mx-auto mt-8">
        <div className="text-3xl mb-3">⚙️</div>
        <div className="font-semibold text-gray-800 mb-2">Rolling window not set</div>
        <p className="text-sm text-gray-500 mb-4">Set the Flow 1 start month in Settings before uploading files.</p>
        <Link to="/settings" className="btn-primary">Go to Settings</Link>
      </div>
    )
  }

  if (bcUrls.length === 0 && blogUrls.length === 0) {
    return (
      <div className="card p-8 text-center max-w-lg mx-auto mt-8">
        <div className="text-3xl mb-3">🔗</div>
        <div className="font-semibold text-gray-800 mb-2">URL lists are empty</div>
        <p className="text-sm text-gray-500 mb-4">Add BC and Blog URL lists before running VLOOKUP.</p>
        <Link to="/urls" className="btn-primary">Go to URL Manager</Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <DropZone
        dragging={dragging}
        processing={processing}
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onClick={() => fileRef.current.click()}
      />
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx"
        multiple
        className="hidden"
        onChange={e => { processFiles(e.target.files); e.target.value = '' }}
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
  )
}

// ─── Drop Zone ────────────────────────────────────────────────────────────────

function DropZone({ dragging, processing, onDrop, onDragOver, onDragLeave, onClick }) {
  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={onClick}
      className={`card border-2 border-dashed transition-colors cursor-pointer select-none p-10 flex flex-col items-center text-center ${
        dragging ? 'border-brand-500 bg-brand-50' : 'border-gray-300 hover:border-brand-400 hover:bg-gray-50'
      }`}
    >
      {processing ? (
        <>
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mb-3" />
          <div className="font-medium text-gray-700">Processing files…</div>
        </>
      ) : (
        <>
          <div className="text-4xl mb-3">📂</div>
          <div className="font-semibold text-gray-800 mb-1">
            {dragging ? 'Drop files here' : 'Drag & drop .xlsx files (up to 30)'}
          </div>
          <div className="text-sm text-gray-500">
            GSC exports (Pages + Filters sheets) · GA4 exports (Free-form 1 sheet)
          </div>
          <div className="text-xs text-gray-400 mt-2">or click to browse</div>
        </>
      )}
    </div>
  )
}

// ─── Detection Log ────────────────────────────────────────────────────────────

function DetectionLog({ log, onClear }) {
  const icons = { ok: '✅', warn: '⚠️', error: '❌', skip: '⏭️' }
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-800 text-sm">Detection Log</h3>
        <button onClick={onClear} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
      </div>
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {log.map((entry, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            <span className="flex-shrink-0 text-base leading-5">{icons[entry.status]}</span>
            <span className="font-mono text-gray-500 text-xs truncate max-w-[200px]" title={entry.file}>
              {entry.file}
            </span>
            <span className={`text-xs ${entry.status === 'error' ? 'text-red-600' : entry.status === 'warn' ? 'text-yellow-700' : 'text-gray-700'}`}>
              {entry.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Slot Grid ────────────────────────────────────────────────────────────────

const SLOT_ROWS = [
  { id: 'bc_gsc',  label: 'BC GSC',   note: 'dijual + disewa' },
  { id: 'bc_ga4',  label: 'BC GA4',   note: '' },
  { id: 'blog_gsc', label: 'Blog GSC', note: '' },
  { id: 'blog_ga4', label: 'Blog GA4', note: '' },
]

function SlotGrid({ slots, slotStatus, slotTooltip, flow1Data, onClearSlot }) {
  const filled = slots.filter(s => slotStatus('bc_gsc', s.key) === 'green').length
  const total = slots.length

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-900">Slot Status</h2>
        <span className="text-xs text-gray-500">{filled}/{total} months fully filled</span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-sm w-full">
          <thead>
            <tr>
              <th className="text-left text-gray-500 font-medium pb-3 pr-4 w-32">Source</th>
              {slots.map(s => (
                <th key={s.key} className="text-center text-gray-500 font-medium pb-3 px-3 min-w-[80px]">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {SLOT_ROWS.map(row => (
              <tr key={row.id}>
                <td className="py-2.5 pr-4">
                  <div className="font-medium text-gray-700 text-sm">{row.label}</div>
                  {row.note && <div className="text-xs text-gray-400">{row.note}</div>}
                </td>
                {slots.map(s => {
                  const st = slotStatus(row.id, s.key)
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
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-4 mt-3 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="badge-green">●</span> Complete</span>
        <span className="flex items-center gap-1"><span className="badge-yellow">◐</span> Partial</span>
        <span className="flex items-center gap-1"><span className="badge-gray">○</span> Empty</span>
      </div>
    </div>
  )
}

function SlotCell({ status, tooltip, rowId, slotKey, flow1Data, onClear }) {
  const [hover, setHover] = useState(false)

  // Keys to clear for this cell
  function handleClear(e) {
    e.stopPropagation()
    if (rowId === 'bc_gsc') {
      if (confirm('Clear BC GSC data for this month?')) {
        onClear(`bc_gsc_dijual_${slotKey}`)
        onClear(`bc_gsc_disewa_${slotKey}`)
      }
    } else {
      onClear(`${rowId}_${slotKey}`)
    }
  }

  const chip = {
    green:  <span className="badge-green text-xs">●</span>,
    yellow: <span className="badge-yellow text-xs">◐</span>,
    gray:   <span className="badge-gray text-xs">○</span>,
  }[status]

  return (
    <div
      className="relative inline-flex items-center gap-1"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={tooltip}
    >
      {chip}
      {hover && status !== 'gray' && (
        <button
          onClick={handleClear}
          className="text-gray-400 hover:text-red-500 transition-colors"
          title="Clear this slot"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}

// ─── Preview + Export ─────────────────────────────────────────────────────────

function PreviewSection({ previewTab, setPreviewTab, slots, flow1Data, bcUrls, blogUrls, onDownloadCSV, onPushSheets, pushStatus, sheetsUrl }) {
  const urlList = previewTab === 'bc' ? bcUrls : blogUrls
  const output = computeFlow1Output(previewTab, urlList, flow1Data, slots)
  const matchCount = output.filter(r => r.metrics.clicks.some(v => v > 0) || r.metrics.views.some(v => v > 0)).length

  return (
    <div className="space-y-4">
      {/* Export bar */}
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <span className="font-semibold text-gray-800 text-sm mr-2">Export</span>
        {['bc', 'blog'].map(proj => {
          const ps = pushStatus[proj]
          return (
            <div key={proj} className="flex items-center gap-2">
              <button
                onClick={() => onDownloadCSV(proj)}
                className="btn-secondary text-xs"
              >
                ⬇ {proj === 'bc' ? 'BC' : 'Blog'} CSV
              </button>
              <button
                onClick={() => onPushSheets(proj)}
                disabled={ps === 'pushing' || !sheetsUrl}
                className={`btn text-xs ${sheetsUrl ? 'btn-primary' : 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200'}`}
                title={!sheetsUrl ? 'Configure spreadsheet URL in Settings' : ''}
              >
                {ps === 'pushing' ? '…' : ps === 'ok' ? '✓ Pushed!' : '→ Push to Sheets'}
              </button>
              {ps?.startsWith('error:') && (
                <span className="text-xs text-red-600">{ps.slice(6)}</span>
              )}
            </div>
          )
        })}
        {!sheetsUrl && (
          <Link to="/settings" className="text-xs text-gray-400 underline">Configure Sheets URL</Link>
        )}
      </div>

      {/* Preview table */}
      <div className="card">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-200">
          <div className="flex gap-1">
            {['bc', 'blog'].map(tab => (
              <button
                key={tab}
                onClick={() => setPreviewTab(tab)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  previewTab === tab ? 'bg-brand-600 text-white' : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {tab === 'bc' ? 'BC' : 'Blog'}
              </button>
            ))}
          </div>
          <span className="text-xs text-gray-500">
            {matchCount}/{urlList.length} URLs matched · showing first 50
          </span>
        </div>
        <PreviewTable
          project={previewTab}
          output={output.slice(0, 50)}
          slots={slots}
        />
      </div>
    </div>
  )
}

function PreviewTable({ project, output, slots }) {
  if (output.length === 0) {
    return <div className="p-8 text-center text-sm text-gray-400">No URLs in list</div>
  }

  const labelCol = project === 'bc' ? 'main_keyword' : 'keyword'

  return (
    <div className="overflow-x-auto">
      <table className="text-xs w-full">
        <thead className="bg-gray-50 sticky top-0">
          <tr>
            <th className="text-left py-2 px-3 font-medium text-gray-500 sticky left-0 bg-gray-50 z-10 min-w-[140px]">
              {project === 'bc' ? 'Keyword' : 'Keyword'}
            </th>
            <th className="text-left py-2 px-2 font-medium text-gray-500 min-w-[120px]">Slug</th>
            {slots.map(s => (
              <th key={s.key} colSpan={4} className="text-center py-2 px-2 font-medium text-gray-500 border-l border-gray-200 min-w-[160px]">
                {s.label}
              </th>
            ))}
          </tr>
          <tr className="bg-gray-50">
            <th className="sticky left-0 bg-gray-50 z-10" />
            <th />
            {slots.flatMap(s => ['Rank', 'Clicks', 'Views', 'CTR'].map(m => (
              <th key={`${s.key}_${m}`} className="text-center py-1 px-1.5 font-medium text-gray-400 border-l first:border-l-0 border-gray-100">
                {m}
              </th>
            )))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {output.map(({ urlRow, metrics }, i) => {
            const hasData = metrics.clicks.some(v => v > 0) || metrics.views.some(v => v > 0)
            return (
              <tr key={i} className={`hover:bg-gray-50 ${!hasData ? 'opacity-50' : ''}`}>
                <td className="py-1.5 px-3 sticky left-0 bg-white group-hover:bg-gray-50 z-10 max-w-[140px] truncate" title={urlRow[labelCol]}>
                  {urlRow[labelCol] || '—'}
                </td>
                <td className="py-1.5 px-2 font-mono text-gray-400 max-w-[120px] truncate" title={urlRow.slug}>
                  {urlRow.slug || '—'}
                </td>
                {slots.flatMap((s, si) => [
                  <td key={`${si}_rank`} className="py-1.5 px-1.5 text-center border-l border-gray-100">
                    {metrics.rank[si] ? metrics.rank[si].toFixed(1) : <Dash />}
                  </td>,
                  <td key={`${si}_clicks`} className="py-1.5 px-1.5 text-center">
                    {metrics.clicks[si] || <Dash />}
                  </td>,
                  <td key={`${si}_views`} className="py-1.5 px-1.5 text-center">
                    {metrics.views[si] || <Dash />}
                  </td>,
                  <td key={`${si}_ctr`} className="py-1.5 px-1.5 text-center text-gray-500">
                    {metrics.ctr[si] ? formatCTR(metrics.ctr[si]) : <Dash />}
                  </td>,
                ])}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Dash() {
  return <span className="text-gray-300">—</span>
}
