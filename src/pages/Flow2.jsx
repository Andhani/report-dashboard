export default function Flow2() {
  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Flow 2 — Traffic Overview</h2>
        <p className="text-sm text-gray-600">
          Upload 3 files per month: GSC Chart sheet (.xlsx), GA4 Free-form summary (.csv), and GA4
          Leads export (.csv). The dashboard aggregates segment-level metrics across an 8-month
          rolling window and calculates Lead per Views rates.
        </p>
      </div>
      <div className="card p-12 flex flex-col items-center justify-center text-center border-dashed border-2">
        <div className="text-4xl mb-4">🚧</div>
        <div className="font-semibold text-gray-700 mb-1">Coming next</div>
        <div className="text-sm text-gray-500">
          File upload, segment aggregation, lead rate calculation, and export will be built after Flow 1.
        </div>
      </div>
    </div>
  )
}
