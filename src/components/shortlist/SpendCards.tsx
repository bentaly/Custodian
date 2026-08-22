import { ArrowDown01Icon, ArrowUp01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useId, useState } from 'react'
import { fmtMoney } from '../../lib/format'
import { resolveProgrammeColour } from '../../lib/programmeColours'
import { BarMeter } from '../BarMeter'
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
  // Collapsed the card is still allowed to state the total: this is the one figure a
  // board says out loud, and a summary you have to re-open to read is not a summary.
  // The rows are HIDDEN rather than unmounted so Download PDF (window.print) still puts
  // the budget breakdown in the board pack whatever the screen was left looking like.
  const [open, setOpen] = useState(true)
  const panelId = useId()

  return (
    <div
      className="flex min-w-0 flex-col rounded-card border bg-white p-4"
      style={{ borderColor: C.line }}
    >
      {/* The whole heading is the control, so the hit area is the width of the card
          rather than a chevron. Its accessible name is its own text — with the total
          named in full when collapsed, since that figure is then the only one left on
          the card — and `aria-expanded` + `aria-controls` say the rest. The chevron is
          `aria-hidden`: it is a second rendering of `aria-expanded`, and an unnamed
          graphic announced beside it would be noise.
          No focus ring is set here on purpose: the shared `Button` styles none either,
          so both wear the UA's own outline, and the faint `ring-brand/20` this started
          with was a downgrade on a control with no border of its own to sharpen it. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-w-0 items-center justify-between gap-3 rounded-chip text-left"
      >
        <span
          className="min-w-0 truncate font-display text-title font-medium"
          style={{ color: C.ink }}
        >
          Proposed spend <span style={{ color: C.faint }}>· Round budget</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 print:hidden">
          {!open && (
            <span
              className="font-display text-body font-medium tabular-nums"
              style={{ color: C.brand }}
            >
              <span className="sr-only">Total proposed </span>
              {fmtMoney(total)}
            </span>
          )}
          <HugeiconsIcon
            aria-hidden
            icon={open ? ArrowUp01Icon : ArrowDown01Icon}
            size={18}
            color={C.sub}
            strokeWidth={1.8}
          />
        </span>
      </button>

      <div
        id={panelId}
        className={
          open
            ? 'flex flex-col gap-4 pt-4'
            : 'hidden print:flex print:flex-col print:gap-4 print:pt-4'
        }
      >
        <div className="flex flex-col gap-4">
          {rows.map((r, i) => {
            const colour = colourOf(r, i)
            const budget = r.budget && r.budget > 0 ? r.budget : null
            const overBy = budget === null ? 0 : r.committed + r.proposed - budget
            const over = overBy > 0
            // Being over budget is said in WORDS beneath the meter, never by repainting it.
            // The bar used to turn the proposed band red and leave the track the
            // programme's own colour, which read as a rendering fault rather than a
            // warning; painting the whole meter red fixed that but cost the row the one
            // thing its colour is for — saying which programme this is.

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
                  /* Three bands on one meter: what this shortlist would add, then what the
                   round has already committed, then what would be left. Without the
                   second the bar would say a programme is 8% spent when most of its
                   budget is already gone.
                   The solid band goes FIRST, anchored at zero as the comp draws it — led
                   by the pale one it floats in the middle of the track, and a pale
                   left-hand chunk reads as budget left rather than budget spent. So the
                   bar runs dark to light, and so does the line beneath it.
                   Over budget the unallocated band is empty and the meter divides between
                   the two spend bands — a full meter is what the dominos always draw, and
                   the overspend is said in words beneath rather than by a bar that grows
                   past its own end. */
                  <BarMeter
                    bars={140}
                    height={24}
                    barWidth={3}
                    className="w-full"
                    segments={[
                      { value: r.proposed, colour },
                      { value: r.committed, colour: tint(colour, 45) },
                      {
                        value: Math.max(0, budget - r.proposed - r.committed),
                        colour: tint(colour, 16),
                      },
                    ]}
                  />
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
                      style={{ color: C.faint }}
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: colour }}
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
                      {/* The only red on the row, and the only thing that needs to be: a
                        board has to be told what is wrong and by how much, not left to
                        infer it from a meter that has changed colour. */}
                      {over && (
                        <span className="font-medium" style={{ color: C.danger }}>
                          {fmtMoney(overBy)} over budget
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

        {/* Kept from the card this one absorbed: what the whole shortlist would cost is
            the figure a board says out loud, and no single row states it. */}
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
    </div>
  )
}
