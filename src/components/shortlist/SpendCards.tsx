import { fmtMoney } from '../../lib/format'
import { resolveProgrammeColour } from '../../lib/programmeColours'
import { C } from '../ui/tokens'

// The two cards the shortlist opens with (Figma 765:3270). They answer the only two
// money questions a board asks before it votes: what is being proposed, and whether the
// round can carry it.

export type SpendRow = {
  roundProgrammeId: string
  programmeName: string
  /** `null` on programmes predating the colour column — see `resolveProgrammeColour`. */
  programmeColour: string | null
  /** `null` when the round-programme has no budget set — no bar can be drawn for it. */
  budget: number | null
  /** Already awarded in this round-programme. */
  committed: number
  /** What this shortlist would add on top. */
  proposed: number
}

/**
 * A programme's swatch: the colour it was assigned, falling back to the positional one
 * for rows predating the column. Same call as the Programmes screen, so a programme is
 * never two different colours in the same app.
 */
function swatch(row: SpendRow, index: number): string {
  return resolveProgrammeColour(row.programmeColour, index)
}

function CardShell({
  title,
  scope,
  children,
}: {
  title: string
  scope: string
  children: React.ReactNode
}) {
  return (
    <div
      className="flex min-w-0 flex-col gap-4 rounded-card border bg-white p-4"
      style={{ borderColor: C.line }}
    >
      <p className="font-display text-title font-medium" style={{ color: C.ink }}>
        {title} <span style={{ color: C.faint }}>· {scope}</span>
      </p>
      {children}
    </div>
  )
}

export function ProposedByProgramme({ rows }: { rows: SpendRow[] }) {
  const total = rows.reduce((s, r) => s + r.proposed, 0)
  return (
    <CardShell title="Proposed spend" scope="By programme">
      <div className="flex flex-col gap-2.5">
        {rows.map((r, i) => (
          <div key={r.roundProgrammeId} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-swatch"
                style={{ backgroundColor: swatch(r, i) }}
              />
              <span className="truncate font-display text-body" style={{ color: C.body }}>
                {r.programmeName}
              </span>
            </span>
            <span
              className="shrink-0 font-display text-body font-medium tabular-nums"
              style={{ color: C.ink }}
            >
              {fmtMoney(r.proposed)}
            </span>
          </div>
        ))}
      </div>
      <div
        className="flex items-center justify-between gap-3 border-t pt-3"
        style={{ borderColor: C.line }}
      >
        <span className="font-display text-body" style={{ color: C.sub }}>
          Total proposed
        </span>
        <span
          className="font-display text-body font-medium tabular-nums"
          style={{ color: C.brand }}
        >
          {fmtMoney(total)}
        </span>
      </div>
    </CardShell>
  )
}

export function ProposedAgainstBudget({ rows }: { rows: SpendRow[] }) {
  // Carry the row's position through the filter: a programme's swatch is its place in
  // the full list, so it must be the same colour on both cards.
  const budgeted = rows
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => r.budget !== null && r.budget > 0)

  return (
    <CardShell title="Proposed spend" scope="Round budget">
      {budgeted.length === 0 ? (
        <p className="font-display text-body" style={{ color: C.sub }}>
          No budget is set on this round’s programmes, so there is nothing to measure the shortlist
          against. Set one on the round to see how much headroom is left.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {budgeted.map(({ r, index }) => {
            const budget = r.budget!
            const colour = swatch(r, index)
            const pct = Math.round((r.proposed / budget) * 100)
            const over = r.committed + r.proposed > budget
            return (
              <div key={r.roundProgrammeId} className="flex flex-col gap-1.5">
                <span className="truncate font-display text-body" style={{ color: C.body }}>
                  {r.programmeName}
                </span>
                {/* Two bands on one track: what the round has already committed, then
                    what this shortlist would add. Without the first the bar would say a
                    programme is 8% spent when most of its budget is already gone. */}
                <span
                  className="relative flex h-1.5 w-full overflow-hidden rounded-full"
                  style={{ backgroundColor: C.wash }}
                >
                  <span
                    className="h-full"
                    style={{
                      width: `${Math.min(100, (r.committed / budget) * 100)}%`,
                      backgroundColor: `color-mix(in srgb, ${colour} 40%, transparent)`,
                    }}
                  />
                  <span
                    className="h-full"
                    style={{
                      width: `${Math.min(100, (r.proposed / budget) * 100)}%`,
                      backgroundColor: over ? C.danger : colour,
                    }}
                  />
                </span>
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className="font-display text-label"
                    style={{ color: over ? C.danger : C.faint }}
                  >
                    {pct}% of round budget
                    {r.committed > 0 && ` · ${fmtMoney(r.committed)} already committed`}
                  </span>
                  <span
                    className="shrink-0 font-display text-body font-medium tabular-nums"
                    style={{ color: C.ink }}
                  >
                    {fmtMoney(r.proposed)}/{fmtMoney(budget)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </CardShell>
  )
}
