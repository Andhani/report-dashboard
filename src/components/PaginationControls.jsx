import { PAGE_SIZE_OPTIONS } from '../hooks/usePagination'

/**
 * Page-size selector + First/Prev/Next/Last controls, shared by any table
 * driven by usePagination (URL Manager, Flow 1 preview).
 */
export default function PaginationControls({ page, pageCount, pageSize, total, onPageSizeChange, onFirst, onPrev, onNext, onLast }) {
  if (total === 0) return null

  const start = pageSize === 'all' ? 1 : (page - 1) * pageSize + 1
  const end = pageSize === 'all' ? total : Math.min(page * pageSize, total)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-2 text-sm text-gray-600">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">Rows per page</span>
        <select
          className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-gray-600 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
          value={pageSize}
          onChange={e => onPageSizeChange(e.target.value === 'all' ? 'all' : Number(e.target.value))}
        >
          {PAGE_SIZE_OPTIONS.map(opt => (
            <option key={opt} value={opt}>{opt === 'all' ? 'All' : opt}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-400">{start}–{end} of {total}</span>
        <div className="flex items-center gap-1">
          <PageBtn label="«" title="First page" onClick={onFirst} disabled={page <= 1} />
          <PageBtn label="‹" title="Previous page" onClick={onPrev} disabled={page <= 1} />
          <span className="text-xs text-gray-500 px-2 whitespace-nowrap">Page {page} / {pageCount}</span>
          <PageBtn label="›" title="Next page" onClick={onNext} disabled={page >= pageCount} />
          <PageBtn label="»" title="Last page" onClick={onLast} disabled={page >= pageCount} />
        </div>
      </div>
    </div>
  )
}

function PageBtn({ label, title, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-7 h-7 flex items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  )
}
