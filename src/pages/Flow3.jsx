export default function Flow3() {
  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Flow 3 — Leads Summary</h2>
        <p className="text-sm text-gray-600">
          No uploads needed. This flow is computed entirely from Flow 1 GA4 per-URL data and Flow 2
          site-wide lead rates. It shows estimated leads for URLs published in the most recent month,
          split by BC and Blog (Create vs Update).
        </p>
      </div>
      <div className="card p-12 flex flex-col items-center justify-center text-center border-dashed border-2">
        <div className="text-4xl mb-4">🚧</div>
        <div className="font-semibold text-gray-700 mb-1">Requires Flow 1 + Flow 2 first</div>
        <div className="text-sm text-gray-500">
          Complete Flow 1 and Flow 2 data entry before this summary can be computed.
        </div>
      </div>
    </div>
  )
}
