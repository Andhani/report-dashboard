export default function Flow1() {
  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Flow 1 — Traffic Import (GSC + GA4)</h2>
        <p className="text-sm text-gray-600">
          Upload up to 30 GSC + GA4 files at once. The dashboard auto-detects each file's project,
          source, month, and segment — then runs VLOOKUP against your URL lists to produce the
          per-URL traffic report across a 6-month rolling window.
        </p>
      </div>
      <div className="card p-12 flex flex-col items-center justify-center text-center border-dashed border-2">
        <div className="text-4xl mb-4">🚧</div>
        <div className="font-semibold text-gray-700 mb-1">Coming next</div>
        <div className="text-sm text-gray-500">
          File upload, auto-detection, merge logic, VLOOKUP, and export will be built in the next phase.
        </div>
      </div>
    </div>
  )
}
