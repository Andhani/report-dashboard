import { useState } from 'react'
import { useStorage } from '../hooks/useStorage'
import { getMonthSlots, formatMonthKey } from '../utils/dateUtils'

export default function Settings() {
  const [oauthToken] = useStorage('google_oauth', null)
  const [flow1Window, setFlow1Window] = useStorage('flow1_window', null)
  const [flow2Window, setFlow2Window] = useStorage('flow2_window', null)
  const [sheetsUrl, setSheetsUrl] = useStorage('sheets_report_url', '')

  const [sheetsInput, setSheetsInput] = useState(sheetsUrl || '')

  // Build month options — current month back 24 months
  const monthOptions = buildMonthOptions()

  function handleSheetsUrl(e) {
    e.preventDefault()
    setSheetsUrl(sheetsInput.trim())
    alert('Spreadsheet URL saved.')
  }

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  const redirectUri = import.meta.env.VITE_REDIRECT_URI || 'http://localhost:3000/auth/callback'

  function handleOAuthConnect() {
    if (!clientId) {
      alert('VITE_GOOGLE_CLIENT_ID is not set in .env')
      return
    }
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      access_type: 'offline',
      prompt: 'consent',
    })
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  }

  function handleDisconnect() {
    if (confirm('Disconnect Google account?')) {
      localStorage.removeItem('google_oauth')
      window.location.reload()
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Google Sheets OAuth */}
      <div className="card p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Google Sheets Connection</h2>
        {oauthToken ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-green-700">
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              Connected — access token stored
            </div>
            <button onClick={handleDisconnect} className="btn-secondary text-red-600 border-red-200 hover:bg-red-50">
              Disconnect
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Connect your Google account to push results directly to a Google Spreadsheet.
            </p>
            {!clientId && (
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                <strong>VITE_GOOGLE_CLIENT_ID</strong> not set — add it to your <code>.env</code> file first.
              </div>
            )}
            <button
              onClick={handleOAuthConnect}
              disabled={!clientId}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Connect with Google
            </button>
          </div>
        )}
      </div>

      {/* Report Spreadsheet URL */}
      <div className="card p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Report Spreadsheet URL</h2>
        <p className="text-sm text-gray-600">
          Paste the URL of the Google Spreadsheet where reports will be written.
        </p>
        <form onSubmit={handleSheetsUrl} className="flex gap-3">
          <input
            type="url"
            className="input flex-1"
            placeholder="https://docs.google.com/spreadsheets/d/..."
            value={sheetsInput}
            onChange={(e) => setSheetsInput(e.target.value)}
          />
          <button type="submit" className="btn-primary flex-shrink-0">Save</button>
        </form>
        {sheetsUrl && (
          <div className="text-xs text-green-700 flex items-center gap-1">
            <span>✓</span> Saved
          </div>
        )}
      </div>

      {/* Flow 1 Rolling Window */}
      <div className="card p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">Flow 1 — Rolling Window (6 months)</h2>
          <p className="text-sm text-gray-600 mt-1">
            Set the first month of the 6-month window for Traffic Import.
          </p>
        </div>
        <div>
          <label className="label">Start Month</label>
          <select
            className="input w-48"
            value={flow1Window || ''}
            onChange={(e) => setFlow1Window(e.target.value || null)}
          >
            <option value="">— Select —</option>
            {monthOptions.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </div>
        {flow1Window && (
          <SlotPreview window={flow1Window} count={6} />
        )}
      </div>

      {/* Flow 2 Rolling Window */}
      <div className="card p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">Flow 2 — Rolling Window (8 months)</h2>
          <p className="text-sm text-gray-600 mt-1">
            Set the first month of the 8-month window for Traffic Overview.
          </p>
        </div>
        <div>
          <label className="label">Start Month</label>
          <select
            className="input w-48"
            value={flow2Window || ''}
            onChange={(e) => setFlow2Window(e.target.value || null)}
          >
            <option value="">— Select —</option>
            {monthOptions.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </div>
        {flow2Window && (
          <SlotPreview window={flow2Window} count={8} />
        )}
      </div>
    </div>
  )
}

function SlotPreview({ window, count }) {
  const slots = getMonthSlots(window, count)
  return (
    <div className="flex flex-wrap gap-2">
      {slots.map((s, i) => (
        <span key={s.key} className={`px-3 py-1 rounded-full text-xs font-medium ${i === count - 1 ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-600'}`}>
          {s.label}
        </span>
      ))}
    </div>
  )
}

function buildMonthOptions() {
  const options = []
  const now = new Date()
  // Go back 24 months from current month
  for (let i = 24; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    options.push({ key, label })
  }
  return options
}
