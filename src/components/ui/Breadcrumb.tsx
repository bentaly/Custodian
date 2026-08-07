import { Link, type LinkProps } from '@tanstack/react-router'
import { C } from './tokens'

// Figma node 400:34124. 12px Inter Display, 8px gaps; ancestors in Gray/700 and the
// current page in Gray/400 — the trail reads *quieter* as it reaches where you are,
// which is the opposite of the usual convention, so don't "fix" it. Gray/900 is the
// hover, and the separator.

export type Crumb = {
  label: string
  /** Omit on the last crumb — the page you are already on is not a link. */
  to?: LinkProps['to']
  search?: LinkProps['search']
}

/**
 * The separator, inlined from the design's exported asset (a 12px caret, rotated to
 * point right) rather than swapped for a Hugeicons chevron, so the glyph is exactly
 * the drawn one.
 */
function Separator() {
  return (
    <svg
      viewBox="0 0 12 12"
      className="block size-3 shrink-0"
      fill="none"
      aria-hidden
      focusable="false"
    >
      <path
        transform="rotate(-90 6 6)"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6.35347 7.85343C6.25971 7.94716 6.13256 7.99982 5.99997 7.99982C5.86739 7.99982 5.74024 7.94716 5.64647 7.85343L2.81797 5.02493C2.77022 4.9788 2.73213 4.92363 2.70592 4.86263C2.67972 4.80163 2.66592 4.73602 2.66535 4.66963C2.66477 4.60324 2.67742 4.5374 2.70256 4.47595C2.7277 4.4145 2.76483 4.35868 2.81178 4.31173C2.85872 4.26478 2.91455 4.22766 2.976 4.20252C3.03744 4.17738 3.10328 4.16473 3.16967 4.1653C3.23606 4.16588 3.30167 4.17967 3.36268 4.20588C3.42368 4.23208 3.47885 4.27017 3.52497 4.31793L5.99997 6.79293L8.47497 4.31793C8.56927 4.22685 8.69558 4.17645 8.82667 4.17759C8.95777 4.17873 9.08318 4.23131 9.17588 4.32402C9.26859 4.41672 9.32117 4.54213 9.32231 4.67323C9.32345 4.80433 9.27305 4.93063 9.18197 5.02493L6.35347 7.85343Z"
        fill={C.ink}
      />
    </svg>
  )
}

/**
 * The app's breadcrumb trail. The last item is always the current page and is
 * rendered as plain text; give every other item a `to`.
 */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-2">
        {items.map((item, i) => {
          const last = i === items.length - 1
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-2">
              {last || !item.to ? (
                <span
                  className="font-display text-[12px] whitespace-nowrap"
                  style={{ color: last ? C.faint : C.body }}
                  aria-current={last ? 'page' : undefined}
                >
                  {item.label}
                </span>
              ) : (
                // Hover has to come from a class, not the inline style used above —
                // an inline colour would always beat the hover rule.
                <Link
                  to={item.to}
                  search={item.search}
                  className="font-display text-[12px] whitespace-nowrap text-[#344051] hover:text-[#141C24]"
                >
                  {item.label}
                </Link>
              )}
              {!last && <Separator />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
