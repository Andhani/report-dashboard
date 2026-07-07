import { PAGE_SIZE_OPTIONS } from "../hooks/usePagination";

export default function PaginationControls({
  page,
  pageCount,
  pageSize,
  total,
  onPageSizeChange,
  onFirst,
  onPrev,
  onNext,
  onLast,
}) {
  if (total === 0) return null;

  const start = pageSize === "all" ? 1 : (page - 1) * pageSize + 1;
  const end = pageSize === "all" ? total : Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-2 text-sm text-muted">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted font-mono">Rows</span>
        <select
          className="text-xs border border-border rounded-[6px] px-2 py-1 bg-surface text-ink hover:border-muted focus:outline-none focus:ring-2 focus:ring-accent/20"
          value={pageSize}
          onChange={(e) =>
            onPageSizeChange(
              e.target.value === "all" ? "all" : Number(e.target.value),
            )
          }
        >
          {PAGE_SIZE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt === "all" ? "All" : opt}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted font-mono">
          {start}–{end} of {total}
        </span>
        <div className="flex items-center gap-1">
          <PageBtn label="«" title="First page" onClick={onFirst} disabled={page <= 1} />
          <PageBtn label="‹" title="Previous page" onClick={onPrev} disabled={page <= 1} />
          <span className="text-xs text-muted font-mono px-2 whitespace-nowrap">
            {page} / {pageCount}
          </span>
          <PageBtn label="›" title="Next page" onClick={onNext} disabled={page >= pageCount} />
          <PageBtn label="»" title="Last page" onClick={onLast} disabled={page >= pageCount} />
        </div>
      </div>
    </div>
  );
}

function PageBtn({ label, title, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-7 h-7 flex items-center justify-center rounded-[6px] border border-border text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors font-mono"
    >
      {label}
    </button>
  );
}
