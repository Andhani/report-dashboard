import { useState, useMemo, useEffect } from 'react'

export const PAGE_SIZE_OPTIONS = [50, 100, 200, 500, 'all']

/**
 * Client-side pagination over an already-loaded array. Used by tables that
 * can grow into the thousands of rows (URL Manager, Flow 1 preview) so the
 * DOM only ever holds one page's worth of rows at a time.
 */
export function usePagination(items, defaultPageSize = 100) {
  const [pageSize, setPageSizeState] = useState(defaultPageSize)
  const [page, setPageState] = useState(1)

  const total = items.length
  const pageCount = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(total / pageSize))

  // Clamp page if the underlying dataset shrinks (e.g. rows deleted) or the
  // page size changes.
  useEffect(() => {
    if (page > pageCount) setPageState(pageCount)
  }, [pageCount, page])

  const pageItems = useMemo(() => {
    if (pageSize === 'all') return items
    const start = (page - 1) * pageSize
    return items.slice(start, start + pageSize)
  }, [items, page, pageSize])

  function setPageSize(size) {
    setPageSizeState(size)
    setPageState(1)
  }

  return {
    page,
    pageCount,
    pageSize,
    pageItems,
    total,
    setPageSize,
    goFirst: () => setPageState(1),
    goPrev: () => setPageState(p => Math.max(1, p - 1)),
    goNext: () => setPageState(p => Math.min(pageCount, p + 1)),
    goLast: () => setPageState(pageCount),
  }
}
