import { fmtMoney } from '../../lib/format'
import { resolveProgrammeColour } from '../../lib/programmeColours'
import { C } from '../ui/tokens'

// The card the shortlist opens with (Figma 765:3331). It was two — a list of what is
// being proposed per programme, then the same figures again as bars against budget —
// which asked a board to read one set of numbers twice. One card carries both: the bar
// is the budget answer, the figures beside it are the spend answer.

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
 * A programme's colour: the one it was assigned, falling back to the positional one for
 * rows predating the column. Same call as the Programmes screen, so a programme is never
 * two different colours in the same app.
 */
function colourOf(row: SpendRow, index: number): string {
  return resolveProgrammeColour(row.programmeColour, index)
}

/** The track behind a bar — the programme's own colour, washed out against the card. */
function tint(colour: string, pct: number): string {
  return `color-mix(in srgb, ${colour} ${pct}%, #fff)`
}

export function ProposedSpend({ rows }: { rows: SpendRow[] }) {
  const total = rows.reduce((s, r) => s + r.proposed, 0)

  return (
    <div
      className="flex min-w-0 flex-col gap-4 rounded-card border bg-white p-4"
      style={{ borderColor: C.line }}
    >
      <p className="font-display text-title font-medium" style={{ color: C.ink }}>
        Proposed spend <span style={{ color: C.faint }}>· Round budget</span>
      </p>

      <div className="flex flex-col gap-4">
        {rows.map((r, i) => {
          const colour = colourOf(r, i)
          const budget = r.budget && r.budget > 0 ? r.budget : null
          const over = budget !== null && r.committed + r.proposed > budget

          return (
            <div key={r.roundProgrammeId} className="flex flex-col gap-1.5">
              <span className="flex min-w-0 items-center gap-2">
                {/* Only where there is no bar to carry it: the colour still has to say
                    which programme this row is about. */}
                {budget === null && (
                  <span
                    className="size-2 shrink-0 rounded-swatch"
                    style={{ backgroundColor: colour }}
                  />
                )}
                <span className="truncate font-display text-body" style={{ color: C.body }}>
                  {r.programmeName}
                </span>
              </span>

              {budget !== null && (
                /* Two bands on one track: what this shortlist would add, then what the
                   round has already committed. Without the second the bar would say a
                   programme is 8% spent when most of its budget is already gone.
                   The solid band goes FIRST, anchored at zero as the comp draws it — led
                   by the pale one it floats in the middle of the track, and a pale
                   left-hand chunk reads as budget left rather than budget spent. So the
                   bar runs dark to light, and so does the line beneath it. */
                <span
                  className="relative flex h-1.5 w-full overflow-hidden rounded-full"
                  style={{ backgroundColor: tint(colour, 16) }}
                >
                  <span
                    className="h-full"
                    style={{
                      width: `${Math.min(100, (r.proposed / budget) * 100)}%`,
                      backgroundColor: over ? C.danger : colour,
                    }}
                  />
                  <span
                    className="h-full"
                    style={{
                      width: `${Math.min(100, (r.committed / budget) * 100)}%`,
                      backgroundColor: tint(colour, 45),
                    }}
                  />
                </span>
              )}

              <div className="flex items-baseline justify-between gap-3">
                {/* The key to the bar, rather than a legend on the card: every row is
                    drawn in its own programme's colour, so a card-level key could only
                    ever be right for one of them. A dot in front of each phrase is the
                    same key, in the right colour, for nothing but its own row. */}
                {budget === null ? (
                  <span
                    className="min-w-0 truncate font-display text-label"
                    style={{ color: C.faint }}
                  >
                    No budget set on this programme
                  </span>
                ) : (
                  <span
                    className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 font-display text-label"
                    style={{ color: over ? C.danger : C.faint }}
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: over ? C.danger : colour }}
                      />
                      {Math.round((r.proposed / budget) * 100)}% proposed
                    </span>
                    {r.committed > 0 && (
                      <span className="flex items-center gap-1.5">
                        <span
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: tint(colour, 45) }}
                        />
                        {fmtMoney(r.committed)} already committed
                      </span>
                    )}
                  </span>
                )}
                <span
                  className="shrink-0 font-display text-body font-medium tabular-nums"
                  style={{ color: C.ink }}
                >
                  {fmtMoney(r.proposed)}
                  {budget !== null && <span style={{ color: C.faint }}>/{fmtMoney(budget)}</span>}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Kept from the card this one absorbed: what the whole shortlist would cost is the
          figure a board says out loud, and no single row states it. */}
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
    </div>
  )
}
