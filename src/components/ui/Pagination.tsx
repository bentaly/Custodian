import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { C } from './tokens'

// The app's pager (Figma 400:30554): a "Showing n of N" count on the left and a row
// of 32px page chips on the right, the current page outlined in brand green.

const BOX = 'flex size-8 shrink-0 items-center justify-center rounded-chip border bg-white'

/**
 * The page numbers to render: three at each end, or the current page flanked by its
 * neighbours once you are away from both ends. Always seven slots wide, so the row
 * doesn't reflow as you page through.
 */
export function pageWindow(page: number, pageCount: number): Array<number | '…'> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
  if (page <= 3 || page >= pageCount - 2)
    return [1, 2, 3, '…', pageCount - 2, pageCount - 1, pageCount]
  return [1, '…', page - 1, page, page + 1, '…', pageCount]
}

export function Pagination({
  page,
  pageCount,
  shown,
  total,
  noun,
  onChange,
}: {
  page: number
  pageCount: number
  /** Rows on this page — the "5" in "Showing 5 of 68". */
  shown: number
  total: number
  /** Plural noun for the count line, e.g. "applications". */
  noun: string
  onChange: (page: number) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="font-display text-label" style={{ color: C.sub }}>
        Showing{' '}
        <span className="font-medium" style={{ color: C.brand }}>
          {shown} of {total}
        </span>{' '}
        {noun}
      </p>

      {pageCount > 1 && (
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => onChange(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
            className={`${BOX} disabled:cursor-not-allowed disabled:opacity-40`}
            style={{ borderColor: C.line }}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={16} color={C.sub} />
          </button>

          <div className="flex items-center gap-1">
            {pageWindow(page, pageCount).map((p, i) =>
              p === '…' ? (
                <span
                  key={`gap-${i}`}
                  className={`${BOX} font-display text-body font-medium`}
                  style={{ borderColor: C.line, color: C.sub }}
                >
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  onClick={() => onChange(p)}
                  aria-label={`Page ${p}`}
                  aria-current={p === page ? 'page' : undefined}
                  className={`${BOX} font-display text-body font-medium`}
                  style={{
                    borderColor: p === page ? C.brand : C.line,
                    color: p === page ? C.brand : C.sub,
                  }}
                >
                  {p}
                </button>
              ),
            )}
          </div>

          <button
            type="button"
            onClick={() => onChange(page + 1)}
            disabled={page >= pageCount}
            aria-label="Next page"
            className={`${BOX} disabled:cursor-not-allowed disabled:opacity-40`}
            style={{ borderColor: C.line }}
          >
            <HugeiconsIcon icon={ArrowRight01Icon} size={16} color={C.sub} />
          </button>
        </div>
      )}
    </div>
  )
}
