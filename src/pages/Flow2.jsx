import { useState, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useStorage } from '../hooks/useStorage'
import { getMonthSlots, formatMonthKey, secondsToHmmss } from '../utils/dateUtils'
import { parseFlow2File, parseGSCChartWorkbook, parseGA4FreeFile, parseGA4LeadsFile, getFlow2DataKey, formatFlow2DetectionLabel } from '../utils/parseFlow2'
import { computeFlow2Output, buildFlow2CSV, SEGMENTS, METRICS, formatMetricValue } from '../utils/computeFlow2'
import { downloadCSV, readFileAsArrayBuffer } from '../utils/exportUtils'
import { pushFlow2ToSheets, extractSpreadsheetId, buildWorkbookFromSheet, fetchFirstTabAsCSV } from '../utils/sheetsApi'
import SheetLinkImport from '../components/SheetLinkImport'

export default function Flow2() {
  const [flow2Data, setFlow2Data] = useStorage('flow2_data', {})
  const [flow2Window] = useStorage('flow2_window', null)
  const [sheetsUrl] = useStorage('sheets_report_url', '')

  const [log, setLog] = useState([])
  const [processing, setProcessing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [pushStatus, setPushStatus] = useState(null)
  const fileRef = useRef()

  const slots = flow2Window ? getMonthSlots(flow2Window, 6) : []
  const slotKeys = new Set(slots.map(s => s.key))

  // ─── File processing ────────────────────────────────────────────────────────

  async function processFiles(files) {
    setProcessing(true)
    const newEntries = {}
    const newLog = []

    for (const file of Array.from(files)) {
      if (!file.name.match(/\.(xlsx|csv)$/i)) {
        newLog.push({ file: file.name, status: 'skip', message: 'Not .xlsx or .csv — skipped' })
        continue
      }
      try {
        const buf = await readFileAsArrayBuffer(file)
        const result = await parseFlow2File(file, buf)

        if (!result) {
          newLog.push({ file: file.name, status: 'error', message: 'Could not detect file — check it is a GSC Chart export (.xlsx) or GA4 Free-form / Leads export (.csv)' })
          continue
        }

        const key = getFlow2DataKey(result)
        if (!key) {
          newLog.push({ file: file.name, status: 'warn', message: 'Detected but key could not be generated — skipped' })
          continue
        }

        const mk = formatMonthKey(result.month.year, result.month.month)
        const inWindow = slotKeys.has(mk)

        // Store the full result object (not just rows — Flow 2 stores aggregated values)
        newEntries[key] = result

        newLog.push({
          file: file.name,
          status: inWindow ? 'ok' : 'warn',
          message: formatFlow2DetectionLabel(result) + (inWindow ? '' : ' ⚠ outside current window'),
        })
      } catch (err) {
        newLog.push({ file: file.name, status: 'error', message: err.message })
      }
    }

    setFlow2Data(prev => ({ ...prev, ...newEntries }))
    setLog(prev => [...newLog, ...prev])
    setProcessing(false)
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    processFiles(Array.from(e.dataTransfer.files))
  }

  function clearSlot(key) {
    setFlow2Data(prev => { const n = { ...prev }; delete n[key]; return n })
  }

  // ─── Import from a Google Sheet link ────────────────────────────────────────
  // GSC Chart exports reuse the workbook-based parser (same as .xlsx upload).
  // GA4 Free-form/Leads sheets are single-tab, so they're read back as CSV
  // text and run through the same CSV parsers used for uploaded .csv files.

  async function importFromSheetLink(url) {
    let wb = await buildWorkbookFromSheet(url, ['chart', 'filters'])
    let result = wb.SheetNames.includes('Chart') ? parseGSCChartWorkbook(wb) : null

    if (!result) {
      const csvText = await fetchFirstTabAsCSV(url)
      const lines = csvText.split('\n')
      const isLeads = (lines[2] ?? '').toLowerCase().includes('leads') || (lines[6] ?? '').toLowerCase().includes('key events')
      result = isLeads ? parseGA4LeadsFile(csvText) : parseGA4FreeFile(csvText)
    }

    if (!result) {
      throw new Error('Could not find a GSC Chart tab or a GA4 Free-form/Leads layout in that sheet.')
    }

    const key = getFlow2DataKey(result)
    if (!key) throw new Error('Detected but key could not be generated.')

    const mk = formatMonthKey(result.month.year, result.month.month)
    const inWindow = slotKeys.has(mk)

    setFlow2Data(prev => ({ ...prev, [key]: result }))
    setLog(prev => [{
      file: 'Google Sheet',
      status: inWindow ? 'ok' : 'warn',
      message: formatFlow2DetectionLabel(result) + (inWindow ? '' : ' ⚠ outside current window'),
    }, ...prev])
  }

  // ─── Export ─────────────────────────────────────────────────────────────────

  function handleDownloadCSV() {
    const output = computeFlow2Output(flow2Data, slots)
    const csv = buildFlow2CSV(output, slots)
    const period = slots.length ? `${slots[0].label.replace(' ', '')}–${slots[slots.length - 1].label.replace(' ', '')}` : ''
    downloadCSV(csv, `Traffic_Overview_${period}.csv`)
  }

  async function handlePushSheets() {
    const ssId = extractSpreadsheetId(sheetsUrl)
    if (!ssId) { alert('No spreadsheet URL configured — add it in Settings.'); return }
    setPushStatus('pushing')
    try {
      const output = computeFlow2Output(flow2Data, slots)
      const csv = buildFlow2CSV(output, slots)
      await pushFlow2ToSheets(ssId, csv)
      setPushStatus('ok')
      setTimeout(() => setPushStatus(null), 4000)
    } catch (err) {
      setPushStatus('error:' + err.message)
    }
  }

  // ─── Slot helpers ────────────────────────────────────────────────────────────

  function getSlotStatus(type, segOrAll, slotKey) {
    // type = 'gsc' | 'ga4_free' | 'ga4_leads'
    let key
    if (type === 'gsc') key = `gsc_${segOrAll}_${slotKey}`
    else key = `${type}_${slotKey}`
    return !!flow2Data[key] ? 'green' : 'gray'
  }

  const anyData = Object.keys(flow2Data).length > 0

  if (!flow2Window) {
    return (
      <div className="card p-8 text-center max-w-lg mx-auto mt-8">
        <div className="text-3xl mb-3">⚙️</div>
        <div className="font-semibold text-gray-800 mb-2">Rolling window not set</div>
        <p className="text-sm text-gray-500 mb-4">Set the Flow 2 start month in Settings (6-month window).</p>
        <Link to="/settings" className="btn-primary">Go to Settings</Link>
      </div>
    )
  }

  const output = anyData ? computeFlow2Output(flow2Data, slots) : null

  return (
    <div className="space-y-6">
      {/* What-to-upload guide */}
      <div className="card p-4 bg-purple-50 border-purple-200">
        <div className="text-sm font-semibold text-purple-900 mb-2">
          What to upload — 3 file kinds per month (different from Flow 1)
        </div>
        <ul className="space-y-1.5">
          <li className="flex items-start gap-2 text-sm text-purple-900">
            <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 bg-purple-400" />
            <span><strong>GSC Chart export (.xlsx):</strong> one file per segment (All Organic, /dijual/, /disewa/, Blog) — site-wide totals, not per-URL</span>
          </li>
          <li className="flex items-start gap-2 text-sm text-purple-900">
            <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 bg-purple-400" />
            <span><strong>GA4 Free-form export (.csv):</strong> a single file that covers every segment automatically</span>
          </li>
          <li className="flex items-start gap-2 text-sm text-purple-900">
            <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 bg-purple-400" />
            <span><strong>GA4 Leads export (.csv):</strong> Click_Contact_Agent event count, one file per month</span>
          </li>
        </ul>
      </div>

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
        accept=".xlsx,.csv"
        multiple
        className="hidden"
        onChange={e => { processFiles(e.target.files); e.target.value = '' }}
      />

      {/* Or import straight from a Google Sheet link */}
      <SheetLinkImport
        onImport={importFromSheetLink}
        label="🔗 Or import from a Sheet link instead"
        hint="For GSC Chart, its tabs must be named like the original export (Chart, optionally Filters). GA4 sheets should have a single tab matching the Free-form/Leads layout."
      />

      {/* Detection log */}
      {log.length > 0 && <DetectionLog log={log} onClear={() => setLog([])} />}

      {/* Slot grid */}
      <SlotGrid slots={slots} flow2Data={flow2Data} getSlotStatus={getSlotStatus} onClear={clearSlot} />

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
        dragging ? 'border-purple-500 bg-purple-50' : 'border-gray-300 hover:border-purple-400 hover:bg-gray-50'
      }`}
    >
      {processing ? (
        <>
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mb-3" />
          <div className="font-medium text-gray-700">Processing files…</div>
        </>
      ) : (
        <>
          <div className="text-4xl mb-3">📂</div>
          <div className="font-semibold text-gray-800 mb-1">
            {dragging ? 'Drop files here' : 'Drag & drop Flow 2 files'}
          </div>
          <div className="text-sm text-gray-500 space-y-0.5">
            <div>GSC Chart export (.xlsx) · GA4 Free-form export (.csv) · GA4 Leads export (.csv)</div>
            <div className="text-gray-400">Up to 6 months × 3 files = 18 files at once</div>
          </div>
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
            <span className="font-mono text-gray-500 text-xs truncate max-w-[200px]" title={entry.file}>{entry.file}</span>
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

const SLOT_ROWS_F2 = [
  { id: 'gsc_all_organic', label: 'GSC Chart', sub: 'All Organic', type: 'gsc', seg: 'all_organic' },
  { id: 'gsc_dijual',      label: 'GSC Chart', sub: '/dijual/',    type: 'gsc', seg: 'dijual' },
  { id: 'gsc_disewa',      label: 'GSC Chart', sub: '/disewa/',    type: 'gsc', seg: 'disewa' },
  { id: 'gsc_blog',        label: 'GSC Chart', sub: 'Blog',        type: 'gsc', seg: 'blog' },
  { id: 'ga4_free',        label: 'GA4 Free-form', sub: '(all segs)', type: 'ga4_free', seg: null },
  { id: 'ga4_leads',       label: 'GA4 Leads',     sub: 'Click_Contact', type: 'ga4_leads', seg: null },
]

function SlotGrid({ slots, flow2Data, getSlotStatus, onClear }) {
  return (
    <div className="card p-5">
      <h2 className="font-semibold text-gray-900 mb-4">Slot Status (6-month window)</h2>
      <div className="overflow-x-auto">
        <table className="text-sm w-full">
          <thead>
            <tr>
              <th className="text-left text-gray-500 font-medium pb-3 pr-4 w-36">File Type</th>
              <th className="text-left text-gray-500 font-medium pb-3 pr-4 w-28">Segment</th>
              {slots.map(s => (
                <th key={s.key} className="text-center text-gray-500 font-medium pb-3 px-2 min-w-[70px]">{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {SLOT_ROWS_F2.map(row => (
              <tr key={row.id}>
                <td className="py-2 pr-4 font-medium text-gray-700 text-sm">{row.label}</td>
                <td className="py-2 pr-4 text-gray-500 text-xs">{row.sub}</td>
                {slots.map(s => {
                  const key = row.seg
                    ? `gsc_${row.seg}_${s.key}`
                    : `${row.type}_${s.key}`
                  const filled = !!flow2Data[key]
                  return (
                    <td key={s.key} className="py-2 px-2 text-center">
                      <SlotDot filled={filled} onClear={() => onClear(key)} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-4 mt-3 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="badge-green">●</span> Filled</span>
        <span className="flex items-center gap-1"><span className="badge-gray">○</span> Empty</span>
      </div>
    </div>
  )
}

function SlotDot({ filled, onClear }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      className="inline-flex items-center gap-1"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {filled ? <span className="badge-green text-xs">●</span> : <span className="badge-gray text-xs">○</span>}
      {hover && filled && (
        <button onClick={onClear} className="text-gray-400 hover:text-red-500">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}

// ─── Overview Table ───────────────────────────────────────────────────────────

function OverviewSection({ output, slots, onDownloadCSV, onPushSheets, pushStatus, sheetsUrl }) {
  const [activeSeg, setActiveSeg] = useState('all_organic')

  return (
    <div className="space-y-4">
      {/* Export bar */}
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <span className="font-semibold text-gray-800 text-sm mr-2">Export</span>
        <button onClick={onDownloadCSV} className="btn-secondary text-xs">⬇ Download CSV</button>
        <button
          onClick={onPushSheets}
          disabled={pushStatus === 'pushing' || !sheetsUrl}
          className={`btn text-xs ${sheetsUrl ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'}`}
        >
          {pushStatus === 'pushing' ? '…' : pushStatus === 'ok' ? '✓ Pushed!' : '→ Push to Sheets'}
        </button>
        {typeof pushStatus === 'string' && pushStatus.startsWith('error:') && (
          <span className="text-xs text-red-600">{pushStatus.slice(6)}</span>
        )}
        {!sheetsUrl && <Link to="/settings" className="text-xs text-gray-400 underline">Configure Sheets URL</Link>}
      </div>

      {/* Segment tabs + metrics table */}
      <div className="card">
        <div className="flex gap-1 px-5 pt-4 pb-3 border-b border-gray-200 overflow-x-auto">
          {SEGMENTS.map(seg => (
            <button
              key={seg.id}
              onClick={() => setActiveSeg(seg.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                activeSeg === seg.id ? 'bg-purple-600 text-white' : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {seg.label}
            </button>
          ))}
        </div>
        <SegmentTable segId={activeSeg} output={output} slots={slots} />
      </div>
    </div>
  )
}

function SegmentTable({ segId, output, slots }) {
  const segData = output[segId] ?? {}

  return (
    <div className="overflow-x-auto">
      <table className="text-sm w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className="text-left py-3 px-4 font-medium text-gray-500 w-48 sticky left-0 bg-gray-50">Metric</th>
            {slots.map(s => (
              <th key={s.key} className="text-center py-3 px-3 font-medium text-gray-500 min-w-[90px]">{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {METRICS.filter(m => !m.allOnly || segId === 'all_organic').map(metric => (
            <tr key={metric.id} className="hover:bg-gray-50">
              <td className="py-2.5 px-4 text-gray-700 text-sm sticky left-0 bg-white">{metric.label}</td>
              {slots.map(s => {
                const val = segData[s.key]?.[metric.id]
                const hasData = val !== null && val !== undefined && val !== 0
                return (
                  <td key={s.key} className={`py-2.5 px-3 text-center text-sm ${hasData ? 'text-gray-900' : 'text-gray-300'}`}>
                    {hasData ? formatMetricValue(metric.id, val) : '—'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
