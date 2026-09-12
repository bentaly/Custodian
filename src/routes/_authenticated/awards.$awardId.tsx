import { createFileRoute, useRouter } from '@tanstack/react-router'
import { orNotFound } from '../../lib/loader'
import { parseAwardsSearch } from '../../lib/listSearch'
import { useState, type ReactNode } from 'react'
import { getAward, GRANT_STATUS_LABELS } from '../../server/fns/applications'
import { resendAwardLetter } from '../../server/fns/awardSetup'
import { AwardLetterPreview } from '../../components/AwardLetterPreview'
import { ApplicationSubmissionDialog } from '../../components/ApplicationSubmissionDialog'
import { ReportFields } from '../../components/ReportFields'
import { AwardSchedule } from '../../components/awards/AwardSchedule'
import { Donut } from '../../components/charts/Donut'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { Alert02Icon, Share04Icon } from '@hugeicons/core-free-icons'
import {
  Badge,
  Boundary,
  BreadcrumbBar,
  Button,
  CardTitle,
  ClampToggle,
  ConfirmDialog,
  DetailHeader,
  DetailRow,
  Dialog,
  Dot,
  Panel,
  RelatedLink,
  ThemePills,
  useClamp,
} from '../../components/ui'
import { C, bandForScore } from '../../components/ui/tokens'
import { AREA_ICON } from '../../components/Sidebar'
import { fmtDate, fmtMoney, fmtRef } from '../../lib/format'
import { formatDecileRange } from '../../lib/deprivation/types'
import { fmtQuantity } from '../../lib/reportTimeline'
import { todayIso } from '../../lib/schedule'
import { averageAlignment, nextPaymentPill } from '../../lib/awardScreen'

// ─── A grant ─────────────────────────────────────────────────────────────────
//
// The award screen (Figma 1347:540), laid out as the report screen is: the grant's own
// working in a main column — its size and reach, where the money has got to, and the
// schedule that moves it along — with what it was for and where it came from beside it.
// The two screens share their side-column furniture (`ui/DetailCard`) and their timeline
// (`grantTimeline`), so a grant reads the same from either door.
//
// It replaced four stat tiles and six stacked panels. What the tiles said is in the top
// two cards; what the panels listed is on the one schedule.

export const Route = createFileRoute('/_authenticated/awards/$awardId')({
  // Not this screen's state — the REGISTER's, carried in by the row that was clicked so
  // the back arrow returns to the list as it was read. See `lib/listSearch`.
  validateSearch: parseAwardsSearch,
  loader: ({ params }) => orNotFound(getAward({ data: { id: params.awardId } })),
  component: AwardDetail,
})

type AwardData = Awaited<ReturnType<typeof getAward>>
type Report = AwardData['reports'][number]

/** The lifecycle colour, on the same three values the awards list bands (`GRANT_STATUS_HEX`
 *  there) — a grant's status must not be one colour in the table and another on its page. */
const AWARD_STATUS_HEX: Record<string, string> = {
  active: C.success,
  completed: C.sub,
  cancelled: C.danger,
}

function AwardDetail() {
  const award = Route.useLoaderData()
  /* The register's state, riding through so the way out restores it. `{}` when the
     reader arrived from anywhere else. */
  const listSearch = Route.useSearch()
  const [letterOpen, setLetterOpen] = useState(false)

  // Every report that arrived, by name, as a way off this screen. There are rarely more
  // than three; if a grant ever collects enough to crowd the row, that is the day to
  // fold them (see `RelatedLink` on why they are not a menu).
  const arrived = award.reporting.filter((e) => e.received && e.openable)

  return (
    <div className="flex flex-col gap-4">
      {/* The crumb is the same gesture as the back arrow below it, so it carries the
          same list state. Opposite it, the records this grant came from and gave rise
          to: onward NAVIGATION lives on this row on every detail screen, never among the
          header's actions — see `RelatedLink`. */}
      <BreadcrumbBar
        items={[
          { label: 'Awards', to: '/awards', search: listSearch },
          { label: award.organisationName },
        ]}
        related={
          <>
            <RelatedLink
              to="/applications/$applicationId"
              params={{ applicationId: award.application.id }}
              icon={AREA_ICON['/applications']}
            >
              Application
            </RelatedLink>
            {arrived.map((e) => (
              <RelatedLink
                key={e.key}
                to="/reports/$reportKey"
                params={{ reportKey: e.key }}
                icon={AREA_ICON['/reports']}
              >
                {e.label}
              </RelatedLink>
            ))}
          </>
        }
      />

      <DetailHeader
        backTo="/awards"
        /* Back to the REGISTER AS IT WAS — round, programme, status, sort, page. Empty
           when the reader arrived from anywhere else (Finance, a report, the dashboard),
           which lands on the plain register as before. */
        backSearch={listSearch}
        backLabel="Back to awards"
        name={award.organisationName}
        // The foundation's own reference first: it is how they will look this grant up
        // in their own systems, and it reads in the same place on every screen that
        // names a grantee. Programme and round are in the card beneath.
        subline={[
          fmtRef(award.application.externalApplicationId),
          `Awarded ${fmtDate(award.decisionAt)}`,
        ]
          .filter(Boolean)
          .join(' · ')}
        // Toned, not neutral: whether this grant is Active, Complete or Cancelled decides
        // whether money is still moving, and it was arriving in grey.
        status={{
          label: GRANT_STATUS_LABELS[award.status] ?? award.status,
          colour: AWARD_STATUS_HEX[award.status] ?? C.sub,
          tone: 'toned',
        }}
      />

      {/* Two columns from `xl`, as on the report screen: below that the side column
          would squeeze the schedule to a strip, so it drops beneath instead. */}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <HeadlineCard award={award} />
          <PaymentsCard award={award} />
          <AwardSchedule award={award} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <PurposeCard award={award} />
          <GrantDetailsCard award={award} />
          <AwardLetterCard award={award} onRead={() => setLetterOpen(true)} />
          <SubmissionsCard award={award} />
          <ScoresCard award={award} />
        </div>
      </div>

      {award.letter && (
        <Dialog
          open={letterOpen}
          onClose={() => setLetterOpen(false)}
          title="Award letter"
          description={award.letter.subject}
          size="lg"
        >
          <AwardLetterPreview bodyText={award.letter.bodyText} />
        </Dialog>
      )}
    </div>
  )
}

// ─── Main column ─────────────────────────────────────────────────────────────

/** One labelled fact on the headline card's foot: "Round: Autumn 2025". */
function FootFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1 font-display text-body">
      <span className="shrink-0" style={{ color: C.sub }}>
        {label}:
      </span>
      <span className="min-w-0 font-medium" style={{ color: C.ink }}>
        {children}
      </span>
    </div>
  )
}

/**
 * What the grant is, in two figures: the money, and what it has reached so far against
 * what it set out to reach. Impact is summed across every report, the way Insights sums
 * it, and set against the application's proposal for the WHOLE grant — so a grant
 * halfway through reads as "310 of 600", which is progress, not a shortfall.
 */
function HeadlineCard({ award }: { award: AwardData }) {
  const years = award.durationYears
  const { impact } = award
  const unit = award.impactUnitLabel
  const dash = <span style={{ color: C.faint }}>—</span>

  return (
    <div
      className="flex flex-col gap-3 rounded-card border bg-white px-1 pt-1 pb-3"
      style={{ borderColor: C.line }}
    >
      <Boundary label="Award">
        <div
          className="flex flex-wrap gap-x-6 gap-y-6 rounded-control px-3 py-6"
          style={{ backgroundColor: C.wash }}
        >
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <p className="font-display text-body" style={{ color: C.sub }}>
              Award total
            </p>
            <p className="flex flex-wrap items-baseline gap-x-1.5">
              <span
                className="font-display text-display font-medium leading-none tabular-nums"
                style={{ color: C.ink }}
              >
                {fmtMoney(award.amountAwarded)}
              </span>
              {years != null && years > 0 && (
                <span className="font-display text-title" style={{ color: C.sub }}>
                  {years === 1 ? 'single year' : `over ${years} years`}
                </span>
              )}
            </p>
          </div>
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <p className="font-display text-body" style={{ color: C.sub }}>
              {unit ? `Impact measured in ${unit}` : 'Impact reported'}
            </p>
            {impact.total != null ? (
              <p className="flex flex-wrap items-baseline gap-x-1.5">
                <span
                  className="font-display text-display font-medium leading-none tabular-nums"
                  style={{ color: C.ink }}
                >
                  {fmtQuantity(impact.total)}
                </span>
                <span className="font-display text-title" style={{ color: C.sub }}>
                  {award.proposedImpact != null && award.proposedImpact > 0
                    ? `of ${fmtQuantity(award.proposedImpact)} reached`
                    : 'reached'}
                </span>
              </p>
            ) : (
              <p className="font-display text-title" style={{ color: C.sub }}>
                None reported yet
                {award.proposedImpact != null && award.proposedImpact > 0
                  ? ` · ${fmtQuantity(award.proposedImpact)} proposed`
                  : ''}
              </p>
            )}
          </div>
        </div>
        {/* Spaced by the card's own `gap-3` — `Boundary` renders its children straight
            into the flex column, so a margin here would be a second gap on top of it. */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-3">
          <FootFact label="Round">{award.roundName ?? dash}</FootFact>
          <FootFact label="Programme">{award.programmeName ?? dash}</FootFact>
          <FootFact label="Themes">
            {award.themes.length === 0 ? dash : <ThemePills themes={award.themes} className="" />}
          </FootFact>
        </div>
      </Boundary>
    </div>
  )
}

const PILL_TONE = {
  grey: { backgroundColor: C.wash, color: C.sub },
  danger: { backgroundColor: C.dangerWash, color: C.danger },
  success: { backgroundColor: C.successWash, color: C.success },
} as const

/**
 * Where the money has got to: paid against unpaid, as a ring and as the two figures it
 * is drawn from. The same `Donut` the dashboard and Insights use, so it sweeps in the
 * same way; hovering a legend row lifts its slice. The proportion is of the AWARD, not
 * of the instalment count — a £40,000 first payment on a £45,000 grant is most of it
 * paid, whatever the count says.
 */
function PaymentsCard({ award }: { award: AwardData }) {
  const [highlight, setHighlight] = useState<string | null>(null)
  const paid = award.paidToDate
  const unpaid = Math.max(0, award.amountAwarded - paid)
  const pct = award.amountAwarded > 0 ? Math.round((paid / award.amountAwarded) * 100) : 0
  const unpaidCount = award.instalmentCount - award.paidCount
  const next = award.instalments.find((i) => !i.paidDate) ?? null
  const pill = nextPaymentPill(next, award.instalmentCount > 0, todayIso())

  // A schedule that does not add up to the award is a real problem — the grantee was
  // promised one figure and the payment run will move another — and it is invisible
  // until someone totals the column by eye.
  const shortfall = award.amountAwarded - award.scheduledTotal
  const unreconciled = award.instalmentCount > 0 && Math.abs(shortfall) >= 1

  const rows = [
    { id: 'paid', label: 'Paid', count: award.paidCount, amount: paid, colour: C.success },
    { id: 'unpaid', label: 'Unpaid', count: unpaidCount, amount: unpaid, colour: C.line },
  ]

  return (
    <Panel label="Payments" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-title font-medium" style={{ color: C.ink }}>
            Payments
          </h2>
          <p className="font-display text-label font-medium" style={{ color: C.sub }}>
            {fmtMoney(paid)} paid of {fmtMoney(award.amountAwarded)} awarded
          </p>
        </div>
        {pill && (
          <span
            className="inline-flex h-6 items-center rounded-pill px-2 font-display text-label font-medium"
            style={PILL_TONE[pill.tone]}
          >
            {pill.text}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-10 gap-y-4 sm:px-6">
        <Donut
          size={120}
          thickness={14}
          highlight={highlight}
          onHighlight={setHighlight}
          data={rows.map((r) => ({
            name: r.label,
            value: r.amount,
            colour: r.colour,
            areaId: r.id,
          }))}
          center={
            <>
              <span
                className="font-display text-heading font-medium leading-none"
                style={{ color: C.ink }}
              >
                {pct}
                <span className="text-label" style={{ color: C.sub }}>
                  %
                </span>
              </span>
              <span className="mt-1 font-display text-label font-medium" style={{ color: C.sub }}>
                Paid
              </span>
            </>
          }
        />
        <div className="flex min-w-60 flex-1 flex-col gap-4">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-3 font-display text-body font-medium transition-opacity"
              style={{ opacity: highlight && highlight !== r.id ? 0.6 : 1 }}
              onMouseEnter={() => setHighlight(r.id)}
              onMouseLeave={() => setHighlight(null)}
            >
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-swatch" style={{ backgroundColor: r.colour }} />
                <span style={{ color: C.ink }}>{r.label}</span>
                {award.instalmentCount > 0 && (
                  <span className="flex items-center" style={{ color: C.sub }}>
                    <Dot />
                    {r.count} instalment{r.count === 1 ? '' : 's'}
                  </span>
                )}
              </span>
              <span className="font-semibold tabular-nums" style={{ color: C.ink }}>
                {fmtMoney(r.amount)}
              </span>
            </div>
          ))}
          <p
            className="flex flex-wrap items-center font-display text-body"
            style={{ color: C.sub }}
          >
            {next ? (
              <>
                Next payment&nbsp;
                <span className="font-medium">{fmtMoney(next.amount)}</span>
                <Dot />
                {next.dueDate ? `Due ${fmtDate(next.dueDate)}` : 'Date to be confirmed'}
              </>
            ) : award.instalmentCount === 0 ? (
              'No instalment schedule is recorded for this grant.'
            ) : (
              'Every instalment has been paid.'
            )}
          </p>
        </div>
      </div>

      {unreconciled && (
        <p
          className="flex items-start gap-1.5 rounded-chip px-3 py-2 font-display text-label"
          style={{ backgroundColor: C.warningWash, color: C.warning }}
        >
          <HugeiconsIcon icon={Alert02Icon} size={16} color="currentColor" className="shrink-0" />
          <span>
            The schedule totals {fmtMoney(award.scheduledTotal)} —{' '}
            {shortfall > 0 ? `${fmtMoney(shortfall)} less` : `${fmtMoney(-shortfall)} more`} than
            the {fmtMoney(award.amountAwarded)} awarded.
          </span>
        </p>
      )}
    </Panel>
  )
}

// ─── Side column ─────────────────────────────────────────────────────────────

/**
 * The grant's purpose: `awards.purpose`, what the foundation agreed to fund, written at
 * set-up and printed on the letter as "towards {purpose}". `createAwards` PRE-FILLS it
 * from `applications.grant_purpose` (the one-sentence summary the scoring call writes)
 * and the admin rewords it, so the two usually differ — but both are the grant's purpose
 * and wear one title everywhere. An award minted before the column existed falls back to
 * the application's sentence, as on the report screen.
 */
function PurposeCard({ award }: { award: AwardData }) {
  const purpose = award.purpose ?? award.application.grantPurpose
  const clamp = useClamp(purpose, 4)
  // One per line, as `renderAwardLetter` numbers them on the letter — a grant set up with
  // three bespoke terms must not read here as one paragraph.
  const bespoke = (award.specialCondition ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (!purpose && bespoke.length === 0) return null

  return (
    <Panel label="Grant purpose" className="flex flex-col gap-4">
      <CardTitle
        right={
          clamp.clipped || clamp.open ? (
            <ClampToggle open={clamp.open} onToggle={clamp.toggle} label="Read the full purpose" />
          ) : undefined
        }
      >
        Grant purpose
      </CardTitle>
      {purpose ? (
        <p
          ref={clamp.ref}
          className={`font-display text-body leading-normal ${clamp.className ?? ''}`}
          style={{ color: C.body }}
        >
          {purpose}
        </p>
      ) : (
        <p className="font-display text-body" style={{ color: C.sub }}>
          No purpose was recorded when this grant was set up.
        </p>
      )}
      {bespoke.length > 0 && (
        <div className="border-t pt-4" style={{ borderColor: C.line }}>
          <p className="font-display text-label uppercase tracking-wide" style={{ color: C.faint }}>
            {bespoke.length === 1
              ? 'Condition specific to this grant'
              : 'Conditions specific to this grant'}
          </p>
          <ol className="mt-2 flex flex-col gap-2">
            {bespoke.map((line, i) => (
              <li key={i} className="flex gap-2.5">
                <span
                  className="flex size-5 shrink-0 items-center justify-center rounded-swatch font-display text-micro font-semibold tabular-nums"
                  style={{ backgroundColor: C.brandBg, color: C.brand }}
                >
                  {i + 1}
                </span>
                <span className="font-display text-body leading-relaxed" style={{ color: C.body }}>
                  {line}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Panel>
  )
}

/**
 * The facts about the grant the headline card does not already carry — round, programme
 * and themes are on its foot, and a fact printed twice on one screen is two things to
 * keep in step. What is left is how the award compares with the ask, the community it
 * serves, and how the organisation is registered.
 */
function GrantDetailsCard({ award }: { award: AwardData }) {
  const a = award.application
  const years = award.durationYears
  const uplift = award.amountAwarded - a.amountRequested
  const dash = <span style={{ color: C.faint }}>—</span>

  return (
    <Panel label="Grant details" className="flex flex-col gap-4">
      <CardTitle>Grant details</CardTitle>
      <dl className="flex flex-col gap-4">
        <DetailRow label="Award">
          {fmtMoney(award.amountAwarded)}
          {years != null && years > 0 && (
            <span className="whitespace-nowrap font-normal" style={{ color: C.sub }}>
              <Dot />
              {years === 1 ? 'single year' : `over ${years} years`}
            </span>
          )}
        </DetailRow>
        <DetailRow label="Requested">
          {fmtMoney(a.amountRequested)}
          <span className="whitespace-nowrap font-normal" style={{ color: C.sub }}>
            <Dot />
            {Math.abs(uplift) < 1
              ? 'as requested'
              : uplift > 0
                ? `${fmtMoney(uplift)} more awarded`
                : `${fmtMoney(-uplift)} less awarded`}
          </span>
        </DetailRow>
        <DetailRow label="Community context">
          {award.deprivation ? formatDecileRange(award.deprivation) : dash}
        </DetailRow>
        <DetailRow
          label={
            a.charityNumber ? 'Charity number' : a.companyNumber ? 'Company number' : 'Registration'
          }
        >
          {a.charityNumber ?? a.companyNumber ?? dash}
        </DetailRow>
      </dl>
    </Panel>
  )
}

const LETTER_STATUS: Record<string, { label: string; className: string }> = {
  sent: { label: 'Sent', className: 'bg-success/10 text-success' },
  draft: { label: 'Not sent', className: 'bg-warning/10 text-warning' },
  failed: { label: 'Failed to send', className: 'bg-danger/10 text-danger' },
}

/**
 * The letter this grantee was actually sent. Read verbatim from storage rather than
 * re-rendered, so it still reads as what was agreed even after the template, the
 * schedule or the conditions have moved on.
 */
function AwardLetterCard({ award, onRead }: { award: AwardData; onRead: () => void }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const letter = award.letter

  async function handleResend() {
    setBusy(true)
    setError(null)
    try {
      await resendAwardLetter({ data: { awardId: award.id } })
      await router.invalidate()
      setConfirming(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The letter could not be sent')
    } finally {
      setBusy(false)
    }
  }

  if (!letter) {
    return (
      <Panel label="Award letter" className="flex flex-col gap-4">
        <CardTitle>Award letter</CardTitle>
        <p className="font-display text-body leading-normal" style={{ color: C.sub }}>
          No letter was issued for this grant. Letters are written and sent during award set-up —
          grants made before that existed, and grants imported from a back catalogue, have none.
        </p>
      </Panel>
    )
  }

  const status = LETTER_STATUS[letter.status] ?? LETTER_STATUS.draft!
  const strong = (s: string) => (
    <span className="font-medium break-words" style={{ color: C.body }}>
      {s}
    </span>
  )
  const replies = letter.replyTo ? <>, replies to {strong(letter.replyTo)}</> : null

  return (
    <Panel label="Award letter" className="flex flex-col gap-4">
      <CardTitle
        right={<Badge className={`h-6 items-center ${status.className}`}>{status.label}</Badge>}
      >
        Award letter
      </CardTitle>
      <p className="font-display text-body leading-normal" style={{ color: C.sub }}>
        {letter.status === 'sent' ? (
          <>
            Sent {fmtDate(letter.sentAt)} to {strong(letter.recipientEmail ?? 'the grantee')}
            {replies}.
          </>
        ) : letter.recipientEmail ? (
          <>
            {letter.status === 'failed' ? 'Could not be sent to' : 'Not sent yet — addressed to'}{' '}
            {strong(letter.recipientEmail)}
            {replies}.
          </>
        ) : (
          'Not sent — there is no address on the application to send it to.'
        )}
      </p>
      {letter.status !== 'sent' && letter.failureReason && (
        <p
          className="rounded-chip px-3 py-2 font-display text-label"
          style={{ backgroundColor: C.warningWash, color: C.warning }}
        >
          {letter.failureReason}
        </p>
      )}
      {error && !confirming && (
        <p
          className="rounded-chip px-3 py-2 font-display text-label"
          style={{ backgroundColor: C.dangerWash, color: C.danger }}
        >
          {error}
        </p>
      )}
      <div
        className="flex items-center justify-end gap-5 border-t pt-4"
        style={{ borderColor: C.line }}
      >
        {award.canEdit && (
          <Button
            variant="text"
            size="xs"
            onClick={() => {
              setError(null)
              setConfirming(true)
            }}
            disabled={busy}
            style={{ color: C.ink }}
          >
            {busy ? 'Sending…' : letter.status === 'sent' ? 'Resend' : 'Send now'}
          </Button>
        )}
        <Button variant="text" size="xs" icon={Share04Icon} iconPosition="right" onClick={onRead}>
          Read the letter
        </Button>
      </div>

      {/* Sending is a letter to a third party and cannot be taken back, so it is asked
          first — and the question names the address, since resending to the wrong one
          is the mistake worth catching. The stored letter goes out unchanged; nothing
          is re-rendered from today's template. */}
      <ConfirmDialog
        open={confirming}
        title={letter.status === 'sent' ? 'Send this letter again?' : 'Send this letter?'}
        onCancel={() => setConfirming(false)}
        onConfirm={handleResend}
        confirmLabel={letter.status === 'sent' ? 'Send again' : 'Send now'}
        busyLabel="Sending…"
        busy={busy}
        // Irreversible, not destructive: sending a grantee their letter is the job.
        tone="primary"
        error={error ?? undefined}
      >
        The award letter as it was written will be emailed to{' '}
        <span className="font-medium text-grey-900">{letter.recipientEmail ?? 'the grantee'}</span>
        {letter.status === 'sent' && letter.sentAt
          ? `, who was sent it on ${fmtDate(letter.sentAt)}`
          : ''}
        .
      </ConfirmDialog>
    </Panel>
  )
}

/**
 * Everything the grantee has sent — the application that won the grant, then each report
 * that has arrived, in the order they came — each opening in place, exactly as it was
 * sent. Reading what they wrote is a glance, and a glance should not cost a page; the
 * pages themselves (with the score, the analysis, the review) are on the breadcrumb row.
 * Reports still to come are the schedule's, among the payments.
 */
function SubmissionsCard({ award }: { award: AwardData }) {
  const [reading, setReading] = useState<'application' | Report | null>(null)
  const received = award.reporting.flatMap((e) => {
    if (!e.received) return []
    const report = award.reports.find((r) => r.id === e.key || r.scheduleId === e.key)
    return report ? [{ key: e.key, date: e.date, report }] : []
  })

  return (
    <Panel label="View submissions" className="flex flex-col gap-4">
      <CardTitle>View submissions</CardTitle>
      <ul className="flex flex-col gap-4">
        <SubmissionRow
          icon={AREA_ICON['/applications']!}
          label="Application form"
          when={`Submitted ${fmtDate(award.application.submittedAt)}`}
          onOpen={() => setReading('application')}
        />
        {received.map(({ key, date, report }) => (
          <SubmissionRow
            key={key}
            icon={AREA_ICON['/reports']!}
            label={report.label}
            when={`Received ${fmtDate(date)}`}
            onOpen={() => setReading(report)}
          />
        ))}
      </ul>

      <ApplicationSubmissionDialog
        application={award.application.fields}
        programmeName={award.programmeName}
        open={reading === 'application'}
        onClose={() => setReading(null)}
      />
      {reading && reading !== 'application' && (
        <Dialog
          open
          onClose={() => setReading(null)}
          title="Grant report"
          description={`${award.organisationName} · ${reading.label}`}
          size="lg"
        >
          <ReportFields report={reading.fields} />
        </Dialog>
      )}
    </Panel>
  )
}

function SubmissionRow({
  icon,
  label,
  when,
  onOpen,
}: {
  icon: IconSvgElement
  label: string
  when: string
  onOpen: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex min-w-0 items-start gap-2 font-display text-body">
          <HugeiconsIcon icon={icon} size={16} color={C.sub} className="mt-0.5 shrink-0" />
          {/* Inline, so a long name wraps with its date after it rather than being cut
              off — a report's name is the thing being looked for. */}
          <span className="min-w-0">
            <span className="font-medium group-hover:underline" style={{ color: C.ink }}>
              {label}
            </span>
            {/* The dot travels with the date, so a wrap never strands it. */}
            <span className="whitespace-nowrap" style={{ color: C.sub }}>
              <Dot />
              {when}
            </span>
          </span>
        </span>
        <HugeiconsIcon icon={Share04Icon} size={16} color={C.brand} className="shrink-0" />
      </button>
    </li>
  )
}

/** A score, as a title with the figure set right, over the words it came with. */
function ScoreBlock({
  title,
  caption,
  figure,
  colour,
  text,
}: {
  title: string
  caption?: string
  figure: string
  colour: string
  text: string | null
}) {
  const clamp = useClamp(text, 3)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="font-display text-title font-medium" style={{ color: C.ink }}>
            {title}
          </h2>
          {caption && (
            <p className="font-display text-label" style={{ color: C.faint }}>
              {caption}
            </p>
          )}
        </div>
        <span className="flex shrink-0 items-center gap-1">
          <span
            className="font-display text-body font-medium tabular-nums"
            style={{ color: colour }}
          >
            {figure}
          </span>
          {(clamp.clipped || clamp.open) && (
            <ClampToggle
              open={clamp.open}
              onToggle={clamp.toggle}
              label={`Read all of the ${title.toLowerCase()}`}
            />
          )}
        </span>
      </div>
      {text && (
        <div className="border-l-2 pl-2" style={{ borderColor: C.line }}>
          <p
            ref={clamp.ref}
            className={`font-display text-body leading-normal ${clamp.className ?? ''}`}
            style={{ color: C.sub }}
          >
            {text}
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * The grant judged at both ends: the application's Custodian score when it was decided,
 * and how well its reports have kept to it since. Two scales, deliberately — the
 * composite out of 100, an alignment out of 10 like every criterion — each banded by the
 * app's one rule (`bandForScore`), so a colour means the same proportion on both.
 */
function ScoresCard({ award }: { award: AwardData }) {
  const a = award.application
  const scored = a.custodianScoreStatus === 'scored' && a.custodianScore != null
  const alignment = averageAlignment(award.reports)
  // The words under the average are the NEWEST scored report's — the average has none of
  // its own, and the latest is the one that says where the grant is now.
  const latest = award.reports.find((r) => r.applicationAlignment || r.programmeAlignment) ?? null

  return (
    <Panel label="Scores" className="flex flex-col gap-4">
      <ScoreBlock
        title="Application score"
        figure={
          scored
            ? `${a.custodianScore}/100`
            : a.custodianScoreStatus === 'queued'
              ? 'Scoring…'
              : 'Not scored'
        }
        colour={scored ? bandForScore(a.custodianScore!).text : C.faint}
        text={scored ? a.custodianScoreSummary : null}
      />
      {alignment && (
        <ScoreBlock
          title="Report alignment"
          caption={
            alignment.reports === 1
              ? (latest?.label ?? undefined)
              : `Average of ${alignment.reports} reports · latest: ${latest?.label ?? ''}`
          }
          figure={`${alignment.score.toFixed(1)}/10`}
          colour={bandForScore(alignment.score, 10).text}
          text={latest?.aiSummary ?? null}
        />
      )}
    </Panel>
  )
}
