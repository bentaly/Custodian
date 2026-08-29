import { Donut } from './Donut'
import { bandForScore, C } from '../ui/tokens'
import { withAlpha } from '../BarMeter'

/**
 * A score drawn as a ring: the same Recharts `Donut` the dashboard and Insights use
 * (so it animates its arc in on load for free), as two slices — the score and what is
 * left of the scale — with the money tooltip switched off.
 *
 * `outOf` is the scale the figure is QUOTED on, and it travels with the number rather
 * than being the caller's business: the Custodian composite is out of 100, a criterion or
 * a report alignment out of 10. `bandForScore` normalises against it & bands on the
 * proportion (70% / 40%), so the colour means the same thing whichever scale is in play.
 * The scales themselves stay separate for the reason a score is never quoted two ways on
 * two screens — a board that reads `9.1/10` here and `91` there will argue about it.
 *
 * Lifted out of the application detail when the report screen needed the same gauge for
 * its alignment average. One ring, one banding, one centre layout.
 */
export function ScoreRing({
  score,
  outOf = 100,
  size = 120,
  thickness = 12,
  /** Decimal places on the figure in the centre. An average of two 1–10 scores lands on
   *  a half, and rounding it away makes 7.5 and 8 look like the same report. */
  decimals = 0,
}: {
  score: number
  outOf?: 100 | 10
  size?: number
  thickness?: number
  decimals?: number
}) {
  const clamped = Math.max(0, Math.min(outOf, score))
  const band = bandForScore(score, outOf)
  return (
    <Donut
      size={size}
      thickness={thickness}
      tooltip={false}
      data={[
        { name: 'Score', value: clamped, colour: band.fill },
        { name: 'Remaining', value: outOf - clamped, colour: withAlpha(band.fill, 0.2) },
      ]}
      center={
        <div className="flex items-baseline gap-1">
          <span
            className="font-display text-heading font-medium leading-none"
            style={{ color: C.ink }}
          >
            {clamped.toFixed(decimals)}
          </span>
          <span className="font-display text-label" style={{ color: C.faint }}>
            /{outOf}
          </span>
        </div>
      }
    />
  )
}
