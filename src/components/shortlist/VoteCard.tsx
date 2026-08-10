import { useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, CheckmarkCircle02Icon, CancelCircleIcon } from '@hugeicons/core-free-icons'
import { addComment, castVote } from '../../server/fns/comments'
import { CRITERION_DEFINITIONS, type CustodianScoreDetail } from '../../lib/custodianScore'
import type { DeprivationResult } from '../../lib/deprivation/types'
import { impactUnitLabel } from '../../lib/impactUnits'
import { fmtMoney } from '../../lib/format'
import { initials } from '../ui'
import { C } from '../ui/tokens'

// Design tokens (Figma variables — pinned until the token set lands). Same set the
// applications list and settings hub use, so the screens read as one app.

/** The order the criteria read in — the registry's own order. */
const CRITERION_KEYS = Object.keys(CRITERION_DEFINITIONS) as Array<
  keyof typeof CRITERION_DEFINITIONS
>

export type VoteCardApplication = {
  id: string
  organisationName: string
  amountRequested: string
  externalApplicationId: string | null
  charityNumber: string | null
  companyNumber: string | null
  deliveryArea: string | null
  deliveryRegion: string | null
  custodianScore: number | null
  custodianScoreDetail: CustodianScoreDetail | null
  custodianScoreStatus: string
  grantPurpose: string | null
  deprivationContext: DeprivationResult | null
  dueDiligenceStatus: string
  proposedImpactQuantity: string | null
  roundProgramme: {
    grantDurationYears: number | null
    programme: { name: string; impactUnit: string | null; impactUnitLabel: string | null } | null
    round: { name: string } | null
  } | null
  votes: Array<{ userId: string; vote: 'yes' | 'no' }>
  yesVotes: number
  noVotes: number
  trusteeCount: number
  hasMajority: boolean
  oneVoteShort: boolean
}

function Pill({ tone, children }: { tone: 'brand' | 'amber' | 'grey'; children: React.ReactNode }) {
  const style =
    tone === 'brand'
      ? { backgroundColor: C.brandWash, color: C.brand }
      : tone === 'amber'
        ? { backgroundColor: C.amberWash, color: C.amber }
        : { backgroundColor: C.wash, color: C.sub }
  return (
    <span
      className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={style}
    >
      {children}
    </span>
  )
}

function StatusPill({ app }: { app: VoteCardApplication }) {
  if (app.hasMajority) return <Pill tone="brand">Board approved</Pill>
  if (app.oneVoteShort && app.yesVotes > 0) return <Pill tone="amber">One vote needed</Pill>
  if (app.votes.length === 0) return <Pill tone="grey">No votes yet</Pill>
  return null
}

/** A labelled figure in the card's stat strip. */
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div
        className="text-[11px] font-medium uppercase tracking-[.04em]"
        style={{ color: C.faint }}
      >
        {label}
      </div>
      <div
        className="mt-0.5 truncate font-display text-[15px] font-medium"
        style={{ color: C.ink }}
      >
        {value}
      </div>
      {sub && (
        <div className="truncate text-[11px]" style={{ color: C.sub }}>
          {sub}
        </div>
      )}
    </div>
  )
}

function CriterionBar({ label, score }: { label: string; score: number | null }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="truncate" style={{ color: C.sub }}>
          {label}
        </span>
        <span className="shrink-0 font-medium" style={{ color: C.ink }}>
          {score === null ? '—' : score.toFixed(1)}
        </span>
      </div>
      <div
        className="mt-1 h-[5px] overflow-hidden rounded-full"
        style={{ backgroundColor: C.line }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${(score ?? 0) * 10}%`, backgroundColor: C.brand }}
        />
      </div>
    </div>
  )
}

/**
 * One shortlisted application, as a board member meets it: what is being asked for, what
 * the AI made of it, the checks behind it, and where the vote stands — with the vote
 * controls in the same card, so deciding never means leaving the list.
 */
export function VoteCard({
  app,
  trustees,
  userId,
  userRole,
  allowAdminVoting,
}: {
  app: VoteCardApplication
  trustees: Array<{ id: string; name: string }>
  userId: string
  userRole: string
  allowAdminVoting: boolean
}) {
  const router = useRouter()
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const isTrustee = userRole === 'trustee'
  const isAdmin = userRole === 'admin' || userRole === 'superadmin'
  // An admin has no vote of their own (see `castVote`) — they may only record one on a
  // named trustee's behalf, and only when the foundation has switched that on. So the
  // two roles get different controls: a trustee gets the decision buttons, an admin
  // gets per-trustee toggles in the roster above them.
  const canVoteAsSelf = isTrustee
  const canVoteForTrustees = isAdmin && allowAdminVoting

  const voteMap = new Map(app.votes.map((v) => [v.userId, v.vote]))
  const myVote = voteMap.get(userId)
  const detail = app.custodianScoreDetail
  const scored = app.custodianScoreStatus === 'scored' && app.custodianScore !== null
  const programme = app.roundProgramme?.programme
  const amount = parseFloat(app.amountRequested)
  const years = app.roundProgramme?.grantDurationYears ?? null

  const unitLabel = impactUnitLabel(programme?.impactUnit, programme?.impactUnitLabel)
  const impact = app.proposedImpactQuantity ? Number(app.proposedImpactQuantity) : null
  const costPerUnit = impact && impact > 0 ? amount / impact : null

  // Narrow on the payload's own discriminant rather than the denormalised status
  // column, so the fields we read are guaranteed present by the type.
  const deprivation = app.deprivationContext?.status === 'resolved' ? app.deprivationContext : null
  const orgType = app.charityNumber ? 'Reg. charity' : app.companyNumber ? 'Company' : null
  const subline = [
    orgType,
    app.deliveryRegion ?? app.deliveryArea,
    app.externalApplicationId,
    app.roundProgramme?.round?.name,
  ]
    .filter(Boolean)
    .join(' · ')

  const flags = detail?.flags ?? []
  const visibleCriteria = showAll ? CRITERION_KEYS : CRITERION_KEYS.slice(0, 3)

  async function handleVote(vote: 'yes' | 'no', onBehalfOf?: string) {
    setBusy(true)
    setError(null)
    try {
      // The comment rides along with the vote: a trustee who typed a reason and then
      // clicked Approve expects both recorded, not the note thrown away.
      if (comment.trim()) {
        await addComment({ data: { applicationId: app.id, body: comment.trim() } })
        setComment('')
      }
      await castVote({ data: { applicationId: app.id, vote, onBehalfOf } })
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record your vote')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-[20px] border bg-white p-1" style={{ borderColor: C.line }}>
      <div className="flex flex-col gap-0 lg:flex-row">
        {/* ── The application ── */}
        <div className="min-w-0 flex-1 p-4">
          {/* Identity */}
          <div className="flex items-start gap-3">
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: C.wash }}
            >
              <span className="font-display text-[14px] font-semibold" style={{ color: C.ink }}>
                {initials(app.organisationName)}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to="/applications/$applicationId"
                  params={{ applicationId: app.id }}
                  className="font-display text-[16px] font-medium hover:underline"
                  style={{ color: C.ink }}
                >
                  {app.organisationName}
                </Link>
                {programme?.name && <Pill tone="grey">{programme.name}</Pill>}
                <StatusPill app={app} />
              </div>
              <div className="mt-0.5 truncate text-[12px]" style={{ color: C.sub }}>
                {subline || '—'}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-display text-[20px] font-medium" style={{ color: C.ink }}>
                {fmtMoney(amount)}
              </div>
              <div className="text-[11px]" style={{ color: C.faint }}>
                requested{years ? ` · over ${years} yr${years > 1 ? 's' : ''}` : ''}
              </div>
            </div>
          </div>

          {/* Stat strip — the tinted panel the app's KPI cards use */}
          <div
            className="mt-4 grid grid-cols-2 gap-4 rounded-2xl p-4 sm:grid-cols-4"
            style={{ backgroundColor: '#FAFBFC' }}
          >
            <Stat
              label="Custodian score"
              value={scored ? `${app.custodianScore}/100` : '—'}
              sub={scored ? undefined : 'not scored'}
            />
            <Stat
              label={unitLabel}
              value={impact !== null ? impact.toLocaleString('en-GB') : '—'}
              sub={costPerUnit !== null ? `${fmtMoney(costPerUnit)} each` : 'not stated'}
            />
            <Stat
              label="Deprivation"
              value={deprivation ? `Decile ${deprivation.min}–${deprivation.max}` : '—'}
              sub={deprivation ? deprivation.areaName : 'not resolved'}
            />
            <Stat
              label="Due diligence"
              value={
                app.dueDiligenceStatus === 'clear'
                  ? 'Clear'
                  : app.dueDiligenceStatus === 'warning'
                    ? 'Warnings'
                    : app.dueDiligenceStatus === 'blocked'
                      ? 'Blocked'
                      : app.dueDiligenceStatus === 'review'
                        ? 'Manual'
                        : 'Pending'
              }
              sub={app.charityNumber ?? app.companyNumber ?? undefined}
            />
          </div>

          {/* What the money would fund. Above the assessment on purpose: a board reads
              what is being proposed before it reads what we made of it. */}
          {app.grantPurpose && (
            <div className="mt-4">
              <div
                className="text-[11px] font-semibold uppercase tracking-[.04em]"
                style={{ color: C.faint }}
              >
                Grant purpose
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: C.ink }}>
                {app.grantPurpose}
              </p>
            </div>
          )}

          {/* AI assessment */}
          {detail?.summary && (
            <div className="mt-4">
              <div
                className="text-[11px] font-semibold uppercase tracking-[.04em]"
                style={{ color: C.faint }}
              >
                AI assessment
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: C.sub }}>
                {detail.summary}
              </p>
            </div>
          )}

          {/* Concerns the model raised — the thing a board most wants surfaced */}
          {flags.length > 0 && (
            <div className="mt-3 rounded-xl px-3.5 py-2.5" style={{ backgroundColor: C.amberWash }}>
              <div className="flex items-center gap-1.5">
                <HugeiconsIcon icon={Alert02Icon} size={14} color={C.amber} strokeWidth={1.8} />
                <span className="text-[11px] font-semibold" style={{ color: C.amber }}>
                  {flags.length === 1 ? 'One thing to check' : `${flags.length} things to check`}
                </span>
              </div>
              <ul className="mt-1.5 space-y-1">
                {flags.map((f, i) => (
                  <li key={i} className="text-[12px] leading-relaxed" style={{ color: C.amber }}>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Criteria */}
          {scored && (
            <div className="mt-4">
              <div className="flex items-baseline justify-between">
                <span
                  className="text-[11px] font-semibold uppercase tracking-[.04em]"
                  style={{ color: C.faint }}
                >
                  Scoring
                </span>
                <button
                  onClick={() => setShowAll(!showAll)}
                  className="text-[12px] font-medium hover:underline"
                  style={{ color: C.brand }}
                >
                  {showAll ? 'Show less' : `All ${CRITERION_KEYS.length} criteria`}
                </button>
              </div>
              <div className="mt-2 grid gap-x-5 gap-y-2.5 sm:grid-cols-3">
                {visibleCriteria.map((key) => (
                  <CriterionBar
                    key={key}
                    label={CRITERION_DEFINITIONS[key].label}
                    score={detail?.criteria?.[key]?.score ?? null}
                  />
                ))}
              </div>
              {showAll && detail?.criteria && (
                <dl className="mt-3 space-y-2">
                  {CRITERION_KEYS.map((key) => {
                    const rationale = detail.criteria[key]?.rationale
                    if (!rationale) return null
                    return (
                      <div key={key} className="text-[12px] leading-relaxed">
                        <dt className="inline font-medium" style={{ color: C.ink }}>
                          {CRITERION_DEFINITIONS[key].label}.{' '}
                        </dt>
                        <dd className="inline" style={{ color: C.sub }}>
                          {rationale}
                        </dd>
                      </div>
                    )
                  })}
                </dl>
              )}
            </div>
          )}
        </div>

        {/* ── The vote ── */}
        <div
          className="flex w-full flex-col rounded-2xl p-4 lg:w-[268px] lg:shrink-0"
          style={{ backgroundColor: C.wash }}
        >
          <div className="flex items-baseline justify-between">
            <span
              className="text-[11px] font-semibold uppercase tracking-[.04em]"
              style={{ color: C.faint }}
            >
              Board votes
            </span>
            <span className="text-[11px] font-medium" style={{ color: C.sub }}>
              {app.votes.length} of {app.trusteeCount}
            </span>
          </div>

          {trustees.length === 0 ? (
            <p className="mt-3 text-[12px] leading-relaxed" style={{ color: C.sub }}>
              No trustees have been added yet, so nothing can be approved.{' '}
              <Link
                to="/settings/team"
                className="font-medium hover:underline"
                style={{ color: C.brand }}
              >
                Invite trustees
              </Link>
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {trustees.map((t) => {
                const vote = voteMap.get(t.id)
                return (
                  <div key={t.id} className="flex items-center gap-2">
                    <span
                      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white text-[9px] font-semibold"
                      style={{ color: C.sub }}
                    >
                      {initials(t.name)}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate text-[12px]"
                      style={{ color: C.ink, fontWeight: t.id === userId ? 600 : 400 }}
                    >
                      {t.id === userId ? 'You' : t.name}
                    </span>
                    {canVoteForTrustees ? (
                      <span className="flex shrink-0 gap-1">
                        <button
                          onClick={() => handleVote('yes', t.id)}
                          disabled={busy}
                          aria-label={`Approve on behalf of ${t.name}`}
                          className="rounded-md px-1.5 py-0.5 disabled:opacity-50"
                          style={{ backgroundColor: vote === 'yes' ? C.brandWash : 'transparent' }}
                        >
                          <HugeiconsIcon
                            icon={CheckmarkCircle02Icon}
                            size={16}
                            color={vote === 'yes' ? C.brand : C.faint}
                            strokeWidth={1.8}
                          />
                        </button>
                        <button
                          onClick={() => handleVote('no', t.id)}
                          disabled={busy}
                          aria-label={`Decline on behalf of ${t.name}`}
                          className="rounded-md px-1.5 py-0.5 disabled:opacity-50"
                          style={{ backgroundColor: vote === 'no' ? C.dangerWash : 'transparent' }}
                        >
                          <HugeiconsIcon
                            icon={CancelCircleIcon}
                            size={16}
                            color={vote === 'no' ? C.danger : C.faint}
                            strokeWidth={1.8}
                          />
                        </button>
                      </span>
                    ) : (
                      <span
                        className="shrink-0 text-[11px] font-medium"
                        style={{
                          color: vote === 'yes' ? C.brand : vote === 'no' ? C.danger : C.faint,
                        }}
                      >
                        {vote === 'yes' ? 'Approve' : vote === 'no' ? 'Decline' : 'Pending'}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2">
            {canVoteAsSelf && (
              <>
                <textarea
                  placeholder="Add a comment…"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className="h-[54px] w-full resize-none rounded-[10px] border bg-white px-2.5 py-2 text-[12px] focus:outline-hidden focus:ring-2 focus:ring-[#1F7A5C]/25"
                  style={{ borderColor: C.line, color: C.ink }}
                />
                <button
                  onClick={() => handleVote('yes')}
                  disabled={busy}
                  className="flex items-center justify-center gap-1.5 rounded-[10px] py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: C.brand }}
                >
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} strokeWidth={1.8} />
                  {myVote === 'yes' ? 'Approved' : 'Approve'}
                </button>
                <button
                  onClick={() => handleVote('no')}
                  disabled={busy}
                  className="flex items-center justify-center gap-1.5 rounded-[10px] border bg-white py-2.5 text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{
                    borderColor: myVote === 'no' ? C.danger : C.line,
                    color: C.danger,
                    backgroundColor: myVote === 'no' ? C.dangerWash : '#fff',
                  }}
                >
                  <HugeiconsIcon icon={CancelCircleIcon} size={16} strokeWidth={1.8} />
                  {myVote === 'no' ? 'Declined' : 'Decline'}
                </button>
              </>
            )}
            {canVoteForTrustees && (
              <p className="text-[11px] leading-snug" style={{ color: C.sub }}>
                You are recording votes on trustees’ behalf.
              </p>
            )}
            {error && (
              <p className="text-[11px]" style={{ color: C.danger }}>
                {error}
              </p>
            )}
            <Link
              to="/applications/$applicationId"
              params={{ applicationId: app.id }}
              className="py-1 text-center text-[12px] font-medium hover:underline"
              style={{ color: C.brand }}
            >
              View full application →
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
