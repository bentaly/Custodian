import { useRemembered } from '../../lib/useRemembered'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, ArrowDown01Icon, ArrowUp01Icon, Tick01Icon } from '@hugeicons/core-free-icons'
import { Button } from '../ui'
import { C } from '../ui/tokens'
import { CHECK_DEFINITIONS, type DueDiligenceCheckRecord } from '../../lib/dueDiligence'

// ─── Pieces of a record's page that an application and a partnership share ───────
//
// Lifted out of the application screen when the partnership page was brought into line
// with it (Notion, 2026-10-08: "match the layout of Applications ... as aligned and
// consistent as possible"). One copy, so the two pages cannot drift into two ways of
// drawing the same register fact or the same due diligence check.

/**
 * "Show the rest" under a list: the flags under a score, the passed checks under due
 * diligence. A secondary button with a chevron, the same everywhere.
 */
export function Disclosure({
  open,
  onToggle,
  showLabel,
  hideLabel,
}: {
  open: boolean
  onToggle: () => void
  showLabel: string
  hideLabel: string
}) {
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={open ? ArrowUp01Icon : ArrowDown01Icon}
      iconPosition="right"
      onClick={onToggle}
      aria-expanded={open}
    >
      {open ? hideLabel : showLabel}
    </Button>
  )
}

/**
 * The register's credit line, as a link to the entry itself where we can address one.
 * `url` is null where the entry cannot be addressed: then it names the source and links
 * nowhere, rather than a guessed URL that 404s in front of a foundation.
 */
export function RegisterCredit({
  url,
  children,
}: {
  url: string | null
  children: React.ReactNode
}) {
  if (!url) return <>{children}</>
  const register = String(children)
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2"
      title={`Open this entry on the ${register} register`}
    >
      {children}
    </a>
  )
}

/**
 * One cell of the organisation card's fact grid: a label, a figure, and optionally the
 * period that figure only means something with.
 *
 * `empty` is the load-bearing prop: a missing figure is never a bare dash, because "£0
 * of reserves", "the register does not publish it" and "we never asked" are three
 * different facts about a charity. The caller says which.
 */
export function Fact({
  label,
  value,
  empty,
  note,
}: {
  label: string
  /** `null` means we do not have it: say why in `empty`. */
  value: React.ReactNode
  empty?: string
  note?: string | null
}) {
  return (
    <div>
      <dt className="font-display text-label" style={{ color: C.sub }}>
        {label}
      </dt>
      <dd
        className={`mt-0.5 font-display text-body ${value ? 'font-medium' : ''}`}
        style={{ color: value ? C.ink : C.faint }}
      >
        {value ?? empty ?? '--'}
      </dd>
      {value && note && (
        <dd className="font-display text-label" style={{ color: C.sub }}>
          {note}
        </dd>
      )}
    </div>
  )
}

/**
 * The due diligence checks, one row each. A clean screen is twenty-odd green rows and
 * the one thing worth reading is a flag somewhere among them, so passed checks are
 * collapsed by default and anything that is NOT a pass always shows: hiding a flag
 * behind a toggle is the one thing this list must never do.
 */
export function DueDiligenceChecks({
  records,
  rememberAs,
}: {
  records: DueDiligenceCheckRecord[]
  /** Where the open/closed choice is remembered, per screen. */
  rememberAs: string
}) {
  const [showAll, setShowAll] = useRemembered(rememberAs, false)
  const passed = records.filter((r) => r.result === 'pass').length
  const visible = showAll ? records : records.filter((r) => r.result !== 'pass')
  return (
    <div className="flex flex-col gap-1">
      {visible.map((r, i) => {
        const def = CHECK_DEFINITIONS[r.key]
        const ok = r.result === 'pass'
        const failed = r.result === 'fail'
        const colour = ok ? C.brand : failed ? C.danger : C.faint
        return (
          <div
            key={i}
            className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 rounded-chip p-3"
            style={{ backgroundColor: C.wash }}
          >
            <span
              className="shrink-0 font-display text-label font-medium"
              style={{ color: failed ? C.danger : 'var(--color-grey-700)' }}
            >
              {def?.label ?? r.key}
            </span>
            {/* The outcome side wraps rather than shrinking the label: a prior-funding
                line can run to hundreds of characters. */}
            <span
              className="flex min-w-[12rem] flex-1 items-start justify-end gap-1.5 font-display text-label font-medium"
              style={{ color: colour }}
            >
              {failed && (
                <HugeiconsIcon
                  icon={Alert02Icon}
                  size={16}
                  color={colour}
                  className="mt-px shrink-0"
                />
              )}
              <span className="min-w-0 break-words text-right">
                {r.detail ??
                  (ok ? (def?.passSummary ?? 'Clear') : failed ? 'Flagged' : 'Unverified')}
              </span>
              {!failed && (
                <HugeiconsIcon
                  icon={Tick01Icon}
                  size={16}
                  color={colour}
                  className="mt-px shrink-0"
                />
              )}
            </span>
          </div>
        )
      })}
      {passed > 0 && (
        <div className="pt-1">
          <Disclosure
            open={showAll}
            onToggle={() => setShowAll(!showAll)}
            showLabel={`Show ${passed} passed ${passed === 1 ? 'check' : 'checks'}`}
            hideLabel={`Hide ${passed} passed ${passed === 1 ? 'check' : 'checks'}`}
          />
        </div>
      )}
    </div>
  )
}
