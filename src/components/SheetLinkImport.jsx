import { useState } from 'react'

/**
 * Toggleable "paste a Google Sheet link" panel. The actual fetch/parse logic
 * is supplied by the caller via onImport(url) — this component only handles
 * the open/loading/error UI chrome, shared across upload points.
 */
export default function SheetLinkImport({ onImport, label = '🔗 Import from Sheet link', hint }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleImport() {
    setError(null)
    setLoading(true)
    try {
      await onImport(url.trim())
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
      <button onClick={() => setOpen(true)} className="btn-secondary text-xs">
        {label}
      </button>
    )
  }

  return (
    <div className="flex items-start gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg w-full max-w-xl">
      <div className="flex-1 space-y-2">
        <input
          type="url"
          className="input text-sm"
          placeholder="https://docs.google.com/spreadsheets/d/..."
          value={url}
          onChange={e => setUrl(e.target.value)}
          autoFocus
        />
        <p className="text-xs text-gray-500">
          ⚠️ The sheet must be shared with <strong>"Anyone with the link can view"</strong> access.
          {hint ? ` ${hint}` : ''}
        </p>
        {error && <div className="text-xs text-red-600">{error}</div>}
        <div className="flex gap-2">
          <button onClick={handleImport} disabled={!url || loading} className="btn-primary text-xs py-1.5 disabled:opacity-50">
            {loading ? 'Importing…' : 'Import'}
          </button>
          <button onClick={() => { setOpen(false); setError(null) }} className="btn-ghost text-xs py-1.5">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
