import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import {
  Alert02Icon,
  ArchiveIcon,
  CheckListIcon,
  Mail01Icon,
  MailSend01Icon,
  NoteIcon,
  PencilEdit02Icon,
  SearchList01Icon,
} from '@hugeicons/core-free-icons'
import {
  actOnPartnership,
  addPartnershipNote,
  getPartnership,
  linkPartnershipApplication,
  rerunPartnershipAssessment,
  screenPartnership,
  sendPartnershipEmail,
  setPartnershipArchived,
} from '../../server/fns/partnerships'
import { listProgrammes } from '../../server/fns/programmes'
import { listMyRounds } from '../../server/fns/rounds'
import { OutreachDialog } from '../../components/sourcing/OutreachDialog'
import { AssessmentPanel } from '../../components/sourcing/AssessmentPanel'
import { ProgressDialog } from '../../components/partnerships/ProgressDialog'
import type { OutreachKind } from '../../lib/sourcing/outreach'
import { impactUnitLabel } from '../../lib/impactUnits'
import { EOI_STATUS_META } from '../../lib/eois/status'
import { orNotFound } from '../../lib/loader'
import {
  ActionMenu,
  Badge,
  Button,
  ConfirmDialog,
  DetailHeader,
  ErrorNote,
  KeyFact,
  Panel,
  PanelTitle,
  TextLink,
  Textarea,
  TruncatedList,
} from '../../components/ui'
import { C } from '../../components/ui/tokens'
import { Avatar } from '../../components/ui/Avatar'
import {
  PartnershipDialog,
  type PartnershipDraft,
} from '../../components/partnerships/PartnershipDialog'
import { DD_LABEL, DD_TONE_HEX } from '../../components/partnerships/dueDiligenceTone'
import { CHECK_DEFINITIONS } from '../../lib/dueDiligence'
import { parsePartnershipsSearch } from '../../lib/listSearch'
import { fmtAmount, fmtDate } from '../../lib/format'
import { useAction } from '../../lib/useAction'
import { messageFor } from '../../lib/errors'
import {
  assessmentGaps,
  canScreen,
  PARTNERSHIP_ACTION_META,
  PARTNERSHIP_STATUS_META,
  type PartnershipAction,
} from '../../lib/partnerships/status'

// ─── One partnership: a PAGE, not a drawer ───────────────────────────────────
//
// The prototype opened a row in a 460px slide-over. This is a route, and the choice is
// worth stating because the app already contains both patterns and they are not
// interchangeable.
//
// The rule the codebase had already settled on, without ever writing it down: **a
// record you WORK ON gets a route; a thing you CONFIGURE gets a dialog.** Rounds and
// programmes are dialogs — each is a name, some dates and a list of budgets, written in
// one call, and editing them in place keeps the list they belong to on screen (see
// `RoundDialog`). Applications, awards and reports are routes, because each accrues:
// comments, votes, screening results, a schedule, a history.
//
// A partnership accrues. It carries a relationship history that grows for months, a
// due diligence result that arrives from two external registers, an AI assessment, a
// link to any expression of interest they sent, and eventually a link to the application
// it produced. Three further things settle it:
//
//   • **It needs a URL.** "Have a look at Settlefield before Thursday" is the message
//     an admin sends a trustee about this screen, and a drawer has no address. The whole
//     `lib/listSearch` convention exists so a detail route can hand the reader's filters
//     back on the way out — a drawer would be the one record in the app you could not
//     link to.
//   • **Screening is asynchronous work you come back to.** Due diligence hits two
//     registers; the answer is read later, sometimes by someone else.
//   • **A drawer would not fit it.** Squeezing history, screening, an EOI and the
//     actions into 460px produces a scroll tunnel — which is what the prototype's panel
//     was, with each section clipped to a few lines.
//
// The modal is still here, and still right, for the one thing that IS a form: logging a
// partner (`PartnershipDialog`). That is written in one call, from the list, in the
// thirty seconds after a phone call — exactly `RoundDialog`'s case.

export const Route = createFileRoute('/_authenticated/partnerships/$partnershipId')({
  // Not this screen's state — the LIST's, carried in by the row that was clicked so the
  // back arrow returns to the pipeline as it was read. See `lib/listSearch`.
  validateSearch: parsePartnershipsSearch,
  loader: async ({ params }) => {
    const [partnership, programmes, rounds] = await Promise.all([
      orNotFound(getPartnership({ data: { id: params.partnershipId } })),
      // For the programme's forms and impact unit.
      listProgrammes(),
      // For the edit dialog's round and programme.
      listMyRounds(),
    ])
    return { partnership, programmes, rounds }
  },
  component: PartnershipDetail,
})

const STATUS_HEX: Record<string, string> = {
  prospective: C.sub,
  eoi_issued: C.info,
  eoi_received: C.warning,
  invited: C.success,
  declined: C.danger,
  applied: C.success,
}

/**
 * The two invitations wear an envelope because they open the email they send. That is a
 * promise this screen keeps now: the status moves only once the message has gone, or
 * once the admin says they sent it themselves (see `run`).
 */
const ACTION_ICON: Record<PartnershipAction, typeof Alert02Icon> = {
  issue_eoi: MailSend01Icon,
  invite: MailSend01Icon,
  shortlist: CheckListIcon,
  decline: Alert02Icon,
  reopen: NoteIcon,
}

function PartnershipDetail() {
  const router = useRouter()
  const { user } = Route.useRouteContext()
  const { partnership, programmes, rounds } = Route.useLoaderData()
  const listSearch = Route.useSearch()
  const canManage = ['superadmin', 'admin'].includes(user.role)

  const [draft, setDraft] = useState<PartnershipDraft | undefined>()
  const [confirm, setConfirm] = useState<PartnershipAction | undefined>()
  const [archiving, setArchiving] = useState(false)
  const [note, setNote] = useState('')
  const [emailing, setEmailing] = useState<OutreachKind | undefined>()
  const [progressing, setProgressing] = useState(false)

  const act = useAction(actOnPartnership)
  const screen = useAction(screenPartnership)
  const archive = useAction(setPartnershipArchived)
  const postNote = useAction(addPartnershipNote)
  const assess = useAction(rerunPartnershipAssessment)
  const link = useAction(linkPartnershipApplication)

  // The programme as the list has it, for its forms and its impact unit: the record's
  // own join carries only what the header prints.
  const programme = programmes.find((p) => p.id === partnership.programmeId)
  const gaps = assessmentGaps(partnership)

  const meta = PARTNERSHIP_STATUS_META[partnership.status]
  const screenable = canScreen(partnership.charityNumber, partnership.companyNumber)

  const where = partnership.roundProgramme
    ? `${partnership.programme?.name ?? 'Programme'}, ${partnership.roundProgramme.round.name}`
    : null
  const subline = [
    where ?? 'No round chosen',
    partnership.deliveryArea,
    partnership.source,
    `Logged ${fmtDate(partnership.createdAt)}`,
  ]
    .filter(Boolean)
    .join(' · ')

  async function refresh() {
    await router.invalidate()
  }

  /**
   * Moving the pipeline along.
   *
   * The two invitations open the email dialog rather than moving anything: the status
   * changes when Custodian has sent the message, or when the admin presses "I've sent it
   * myself" in that dialog, which is this function. A status never moves on the strength
   * of a draft somebody may have closed. "Progress to shortlist" opens its own dialog,
   * because it has to be put in a round. The rest are decisions taken here.
   */
  async function run(action: Exclude<PartnershipAction, 'shortlist'>) {
    const result = await act.run({ data: { id: partnership.id, action } })
    if (!result) throw act.error ?? new Error('That did not work. Try again.')
    setConfirm(undefined)
    setEmailing(undefined)
    await refresh()
  }

  function start(action: PartnershipAction) {
    if (action === 'issue_eoi') return setEmailing('eoi_invite')
    if (action === 'invite') return setEmailing('apply_invite')
    if (action === 'shortlist') return setProgressing(true)
    if (PARTNERSHIP_ACTION_META[action].destructive) return setConfirm(action)
    void run(action).catch(() => {})
  }

  return (
    <div className="flex flex-col gap-4">
      <DetailHeader
        backTo="/partnerships"
        backSearch={listSearch}
        backLabel="Back to partnerships"
        name={partnership.organisationName}
        subline={subline}
        // Toned, not neutral: on this screen the status IS the headline — it is the
        // answer to "where have we got to with these people", which is the entire
        // reason anybody opened the record.
        status={{ label: meta.label, colour: STATUS_HEX[partnership.status]!, tone: 'toned' }}
        actions={
          canManage &&
          !partnership.archivedAt && (
            <>
              {meta.actions
                // Not offered without a round: an application cannot exist outside one,
                // and the round is where its budget comes from. Rows logged before the
                // round was required say so on the progress panel instead.
                .filter((action) => action !== 'shortlist' || !!partnership.roundProgrammeId)
                .map((action, i) => {
                  const a = PARTNERSHIP_ACTION_META[action]
                  return (
                    <Button
                      key={action}
                      // Destructive is checked FIRST, not after the position. On an
                      // invited partnership the only remaining move is closing it,
                      // which made it index 0 and drew closing a relationship as the
                      // solid green primary button on the screen.
                      variant={a.destructive ? 'dangerGhost' : i === 0 ? 'primary' : 'secondary'}
                      icon={ACTION_ICON[action]}
                      disabled={act.pending}
                      onClick={() => start(action)}
                    >
                      {a.label}
                    </Button>
                  )
                })}
              <ActionMenu
                label={`Actions for ${partnership.organisationName}`}
                actions={[
                  {
                    label: 'Email them',
                    icon: Mail01Icon,
                    onSelect: () => setEmailing('message'),
                  },
                  {
                    label: 'Edit details',
                    icon: PencilEdit02Icon,
                    onSelect: () => setDraft(toDraft(partnership)),
                  },
                  {
                    label: screen.pending ? 'Screening…' : 'Run due diligence',
                    icon: SearchList01Icon,
                    disabled: !screenable || screen.pending,
                    onSelect: async () => {
                      await screen.run({ data: { id: partnership.id } })
                      await refresh()
                    },
                  },
                  {
                    label: 'Archive',
                    icon: ArchiveIcon,
                    destructive: true,
                    onSelect: () => setArchiving(true),
                  },
                ]}
              />
            </>
          )
        }
      />

      <ErrorNote error={act.error} />
      <ErrorNote error={screen.error} />
      <ErrorNote error={assess.error} />
      <ErrorNote error={link.error} />

      {partnership.archivedAt && (
        <Panel label="Archive" className="border-warning/30 bg-warning/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-display text-body" style={{ color: C.body }}>
              Archived {fmtDate(partnership.archivedAt)}
              {partnership.archiveNote ? `: ${partnership.archiveNote}` : ''}
            </p>
            {canManage && (
              <Button
                variant="secondary"
                disabled={archive.pending}
                onClick={async () => {
                  await archive.run({ data: { id: partnership.id, archived: false } })
                  await refresh()
                }}
              >
                {archive.pending ? 'Restoring…' : 'Bring back'}
              </Button>
            )}
          </div>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          {/* What this state MEANS, in a sentence. A pipeline status is a word whose
              consequence is not obvious ("EOI sent" — so is there anything for me to
              do?), and the sentence is the difference between a label and an
              instruction. A tinted strip rather than a card: it annotates the status
              pill three inches above it, and a full panel gave one sentence the same
              weight on the page as the whole expression of interest. */}
          <p
            className="rounded-card px-4 py-3 font-display text-body"
            style={{ backgroundColor: C.brandWash, color: C.body }}
          >
            {meta.description}
          </p>

          {/* The ask, such as it is: what the grant would be for and how much, in the
              foundation's own words. The same two facts an application leads with, and
              labelled "proposed" because nobody outside this building has agreed to
              either. */}
          <Panel label="Proposed grant">
            <PanelTitle>Proposed grant</PanelTitle>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <KeyFact
                label="Grant value proposed"
                value={partnership.amountSought ? fmtAmount(partnership.amountSought) : '--'}
                sub={partnership.amountSought ? 'Not a commitment' : undefined}
              />
              <KeyFact
                label="Proposed impact"
                value={
                  partnership.proposedImpactQuantity
                    ? `${Number(partnership.proposedImpactQuantity).toLocaleString('en-GB')} ${impactUnitLabel(programme?.impactUnit, programme?.impactUnitLabel).toLowerCase()}`
                    : '--'
                }
              />
              <KeyFact label="Delivery area" value={partnership.deliveryArea ?? '--'} />
            </div>
            <p
              className="mt-4 whitespace-pre-wrap font-display text-body"
              style={{ color: partnership.proposedPurpose ? C.body : C.sub }}
            >
              {partnership.proposedPurpose ?? 'No purpose recorded yet.'}
            </p>
            {/* A row logged before the round was required. Said here, beside the facts
                the shortlist would be built from, rather than as a missing button. */}
            {!partnership.roundProgrammeId && !partnership.applicationId && (
              <p className="mt-3 font-display text-label" style={{ color: C.warning }}>
                No round chosen yet, so this partner cannot be taken to the shortlist. Choose one
                under Edit details.
              </p>
            )}
          </Panel>

          <AssessmentPanel
            status={partnership.custodianScoreStatus}
            score={partnership.custodianScore}
            detail={partnership.custodianScoreDetail}
            gaps={gaps}
            canManage={canManage && !partnership.archivedAt && !partnership.applicationId}
            running={assess.pending}
            onRefresh={refresh}
            onRerun={async () => {
              const ok = await assess.run({ data: { id: partnership.id } })
              if (ok) await refresh()
            }}
          />

          {/* What the register says they are. The figures were filed with a regulator;
              the description was written by the charity for that regulator, and says so. */}
          {partnership.organisationProfile && (
            <Panel label="From the charity register">
              <PanelTitle>From the charity register</PanelTitle>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <KeyFact
                  label="Income"
                  value={
                    partnership.organisationProfile.latestIncome != null
                      ? fmtAmount(partnership.organisationProfile.latestIncome)
                      : '--'
                  }
                  sub={
                    partnership.organisationProfile.financialPeriodEnd
                      ? `Year to ${fmtDate(partnership.organisationProfile.financialPeriodEnd)}`
                      : undefined
                  }
                />
                <KeyFact
                  label="Expenditure"
                  value={
                    partnership.organisationProfile.latestExpenditure != null
                      ? fmtAmount(partnership.organisationProfile.latestExpenditure)
                      : '--'
                  }
                />
                <KeyFact
                  label="Employees"
                  value={partnership.organisationProfile.employees?.toLocaleString('en-GB') ?? '--'}
                />
                <KeyFact
                  label="Registered"
                  value={
                    partnership.organisationProfile.registeredSince
                      ? fmtDate(partnership.organisationProfile.registeredSince)
                      : '--'
                  }
                />
              </div>
              {partnership.organisationProfile.activities && (
                <p className="mt-4 font-display text-body" style={{ color: C.body }}>
                  {partnership.organisationProfile.activities}
                </p>
              )}
            </Panel>
          )}

          {/* Have we met them before. Numbers only (see `partnerships/history.ts`), so
              this is silent for an organisation with neither number rather than guessing
              from a name. */}
          {(partnership.history.awards.length > 0 ||
            partnership.history.partnerships.length > 0) && (
            <Panel label="What you already know">
              <PanelTitle>What you already know</PanelTitle>
              <ul className="flex flex-col gap-2">
                {partnership.history.awards.map((award) => (
                  <li key={award.id} className="font-display text-body" style={{ color: C.body }}>
                    <TextLink to="/awards/$awardId" params={{ awardId: award.id }}>
                      {fmtAmount(award.amountAwarded)} awarded
                    </TextLink>{' '}
                    in {new Date(award.decidedAt).getFullYear()}, {award.programmeName}
                    {award.status === 'cancelled' ? ' (cancelled)' : ''}
                  </li>
                ))}
                {partnership.history.partnerships.map((other) => (
                  <li key={other.id} className="font-display text-body" style={{ color: C.body }}>
                    <TextLink
                      to="/partnerships/$partnershipId"
                      params={{ partnershipId: other.id }}
                    >
                      Logged before
                    </TextLink>{' '}
                    on {fmtDate(other.createdAt)}:{' '}
                    {other.archivedAt
                      ? 'archived'
                      : PARTNERSHIP_STATUS_META[other.status].label.toLowerCase()}
                    {other.source ? `, ${other.source}` : ''}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {/* The relationship history — the panel this record exists for. It is not the
              audit log: it starts before the foundation did anything ("introduced by
              James at the May board dinner") and it is written in sentences, because
              what a grants officer needs from it is the story, not a diff. */}
          <Panel label="Relationship history">
            <PanelTitle>Relationship history</PanelTitle>

            {canManage && !partnership.archivedAt && (
              <div className="mb-4 flex flex-col gap-2">
                <Textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add what happened: a call, a visit, a decision taken elsewhere…"
                  aria-label="Add to the relationship history"
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={!note.trim() || postNote.pending}
                    onClick={async () => {
                      const ok = await postNote.run({
                        data: { id: partnership.id, body: note.trim() },
                      })
                      if (!ok) return
                      setNote('')
                      await refresh()
                    }}
                  >
                    {postNote.pending ? 'Adding…' : 'Add note'}
                  </Button>
                </div>
                <ErrorNote error={postNote.error} />
              </div>
            )}

            <ol className="flex flex-col gap-4">
              {partnership.events.map((event) => (
                <li key={event.id} className="flex gap-3">
                  <div className="mt-1.5 flex flex-col items-center gap-1">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: event.kind === 'note' ? C.muted : C.brand }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-body" style={{ color: C.body }}>
                      {event.body}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      {event.actor && (
                        <Avatar name={event.actor.name} image={event.actor.image} size={16} />
                      )}
                      {/* The DATE, not the minute. `occurred_at` is when a thing
                          happened, which for half these entries is a date somebody
                          typed weeks later — "14 August 2026 at 15:23 UTC" states a
                          precision the record does not have. */}
                      <span className="font-display text-label" style={{ color: C.faint }}>
                        {event.actor?.name ?? 'Custodian'} · {fmtDate(event.occurredAt)}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel label="Details">
            <PanelTitle>Details</PanelTitle>
            <div className="grid grid-cols-2 gap-4">
              <KeyFact label="Round" value={partnership.roundProgramme?.round.name ?? '--'} />
              <KeyFact label="Programme" value={partnership.programme?.name ?? '--'} />
              <KeyFact label="Source" value={partnership.source ?? '--'} />
              <KeyFact label="Charity no." value={partnership.charityNumber ?? '--'} />
              <KeyFact label="Company no." value={partnership.companyNumber ?? '--'} />
            </div>
            {/* Full width, not a `sub` under the contact's name: in a 320px column an
                address wraps to an ellipsis at about the "@", which is the half that
                identifies it. It is also the one fact on this panel somebody copies. */}
            {partnership.contactEmail && (
              <div className="mt-4">
                <p
                  className="font-display text-label uppercase tracking-wide"
                  style={{ color: C.faint }}
                >
                  Contact email
                </p>
                <a
                  href={`mailto:${partnership.contactEmail}`}
                  className="mt-0.5 block break-all font-display text-body font-medium hover:underline"
                  style={{ color: C.brand }}
                >
                  {partnership.contactEmail}
                </a>
              </div>
            )}
            {(partnership.tags ?? []).length > 0 && (
              <div className="mt-4">
                <p
                  className="font-display text-label uppercase tracking-wide"
                  style={{ color: C.faint }}
                >
                  Themes, from the assessment
                </p>
                <div className="mt-1.5">
                  <TruncatedList
                    items={partnership.tags ?? []}
                    label="Themes"
                    className="font-display text-body text-grey-500"
                  />
                </div>
              </div>
            )}
          </Panel>

          <Panel label="Due diligence">
            <PanelTitle
              right={
                <Badge
                  className="text-label"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${DD_TONE_HEX[partnership.dueDiligenceStatus]} 10%, transparent)`,
                    color: DD_TONE_HEX[partnership.dueDiligenceStatus],
                  }}
                >
                  {DD_LABEL[partnership.dueDiligenceStatus]}
                </Badge>
              }
            >
              Due diligence
            </PanelTitle>

            {/* The one dead end screening has, and the only way out of it: with both
                numbers NULL there is nothing to check, and pressing a button reads the
                same nothing however often it is pressed. So the panel says so and points
                at the fix rather than offering the button. */}
            {!screenable ? (
              <p className="font-display text-body" style={{ color: C.sub }}>
                No charity or company number on record, so there is nothing to screen against. Add
                one under Edit details and it will screen on the spot.
              </p>
            ) : (
              <>
                {(partnership.dueDiligenceChecks ?? []).length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {(partnership.dueDiligenceChecks ?? []).map((check) => {
                      const definition = CHECK_DEFINITIONS[check.key]
                      return (
                        <li
                          key={check.key}
                          className="flex items-start justify-between gap-3 border-b pb-2 last:border-0"
                          style={{ borderColor: C.line }}
                        >
                          <div className="min-w-0">
                            <p className="font-display text-body" style={{ color: C.body }}>
                              {definition?.label ?? check.key}
                            </p>
                            {check.detail && (
                              <p className="font-display text-label" style={{ color: C.faint }}>
                                {check.detail}
                              </p>
                            )}
                          </div>
                          <span
                            className="shrink-0 font-display text-label font-medium"
                            style={{
                              color:
                                check.result === 'pass'
                                  ? C.success
                                  : check.result === 'fail'
                                    ? C.danger
                                    : C.faint,
                            }}
                          >
                            {check.result === 'pass'
                              ? 'Pass'
                              : check.result === 'fail'
                                ? 'Fail'
                                : 'Not verified'}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="font-display text-body" style={{ color: C.sub }}>
                    Not screened yet.
                  </p>
                )}
                {canManage && (
                  <Button
                    className="mt-4 w-full"
                    variant="secondary"
                    size="sm"
                    disabled={screen.pending}
                    onClick={async () => {
                      await screen.run({ data: { id: partnership.id } })
                      await refresh()
                    }}
                  >
                    {screen.pending
                      ? 'Screening…'
                      : partnership.dueDiligenceCheckedAt
                        ? 'Re-run screening'
                        : 'Run screening'}
                  </Button>
                )}
                {partnership.dueDiligenceCheckedAt && (
                  <p
                    className="mt-2 text-center font-display text-label"
                    style={{ color: C.faint }}
                  >
                    Last run {fmtDate(partnership.dueDiligenceCheckedAt)}
                  </p>
                )}
              </>
            )}
          </Panel>

          {/* Their expression of interest. The submission itself lives with every other
              EOI, on Applications; this is only the way through to it. */}
          {partnership.eois.length > 0 && (
            <Panel label="Expression of interest">
              <PanelTitle>Expression of interest</PanelTitle>
              <ul className="flex flex-col gap-2">
                {partnership.eois.map((eoi) => (
                  <li key={eoi.id} className="font-display text-body" style={{ color: C.body }}>
                    <TextLink to="/applications/eois/$eoiId" params={{ eoiId: eoi.id }}>
                      Received {fmtDate(eoi.createdAt)}
                    </TextLink>{' '}
                    · {EOI_STATUS_META[eoi.status].label.toLowerCase()}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {/* Where the pipeline hands over. Once there is an application it is the
              record of the ask and this stops moving, so the last thing the screen says
              is what it turned into. */}
          {partnership.application && (
            <Panel label="What this became">
              <PanelTitle>What this became</PanelTitle>
              <p className="font-display text-body" style={{ color: C.body }}>
                <TextLink
                  to="/applications/$applicationId"
                  params={{ applicationId: partnership.application.id }}
                >
                  The application
                </TextLink>{' '}
                carries on from here.
              </p>
            </Panel>
          )}

          {/* The link is made by itself when their form hands the reference back. When
              it did not, an application with the same registration number is probably
              theirs, and an admin can say so. Offered, never assumed. */}
          {canManage &&
            !partnership.application &&
            partnership.applicationCandidates.length > 0 && (
              <Panel label="Is this their application?">
                <PanelTitle>Is this their application?</PanelTitle>
                <ul className="flex flex-col gap-3">
                  {partnership.applicationCandidates.map((candidate) => (
                    <li key={candidate.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <TextLink
                          to="/applications/$applicationId"
                          params={{ applicationId: candidate.id }}
                        >
                          {candidate.organisationName}
                        </TextLink>
                        <p className="font-display text-label" style={{ color: C.faint }}>
                          {candidate.programmeName} · {fmtDate(candidate.createdAt)}
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={link.pending}
                        onClick={async () => {
                          const ok = await link.run({
                            data: { id: partnership.id, applicationId: candidate.id },
                          })
                          if (ok) await refresh()
                        }}
                      >
                        Link
                      </Button>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
        </div>
      </div>

      <PartnershipDialog
        open={draft !== undefined}
        draft={draft}
        rounds={rounds}
        onClose={() => setDraft(undefined)}
        onSaved={async () => {
          setDraft(undefined)
          await refresh()
        }}
      />

      {emailing && (
        <OutreachDialog
          key={emailing}
          kind={emailing}
          organisationName={partnership.organisationName}
          defaultTo={partnership.contactEmail}
          contactName={null}
          programmeName={partnership.programme?.name ?? null}
          sender={partnership.sender}
          onClose={() => setEmailing(undefined)}
          onSend={async (values) => {
            await sendPartnershipEmail({
              data: { id: partnership.id, kind: emailing, ...values },
            })
            setEmailing(undefined)
            await refresh()
          }}
          // Already at that stage means this is a chase, and there is nothing to mark.
          onMarkSent={
            emailing === 'message' ||
            !meta.actions.includes(emailing === 'eoi_invite' ? 'issue_eoi' : 'invite')
              ? undefined
              : () => run(emailing === 'eoi_invite' ? 'issue_eoi' : 'invite')
          }
        />
      )}

      {progressing && (
        <ProgressDialog
          partnership={partnership}
          where={where ?? ''}
          onClose={() => setProgressing(false)}
          onDone={async () => {
            setProgressing(false)
            await refresh()
          }}
        />
      )}

      <ConfirmDialog
        open={confirm !== undefined}
        title="Close this partnership?"
        confirmLabel="Close"
        busyLabel="Closing…"
        busy={act.pending}
        error={act.error ? messageFor(act.error) : undefined}
        onCancel={() => setConfirm(undefined)}
        onConfirm={() => {
          if (confirm && confirm !== 'shortlist') void run(confirm).catch(() => {})
        }}
      >
        <p>
          {partnership.organisationName} moves out of the live pipeline and the decision is written
          into the relationship history. You can reopen it at any time.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={archiving}
        title="Archive this partner?"
        confirmLabel="Archive"
        busyLabel="Archiving…"
        busy={archive.pending}
        error={archive.error ? messageFor(archive.error) : undefined}
        onCancel={() => setArchiving(false)}
        onConfirm={async () => {
          const ok = await archive.run({ data: { id: partnership.id, archived: true } })
          if (!ok) return
          setArchiving(false)
          await refresh()
        }}
      >
        <p>
          {partnership.organisationName} leaves the pipeline and its history is kept. Nothing is
          deleted, and you can bring them back.
        </p>
      </ConfirmDialog>
    </div>
  )
}

/** The record as the dialog's fields — every nullable column becomes an empty string. */
function toDraft(p: Awaited<ReturnType<typeof getPartnership>>): PartnershipDraft {
  return {
    id: p.id,
    organisationName: p.organisationName,
    charityNumber: p.charityNumber ?? '',
    companyNumber: p.companyNumber ?? '',
    source: p.source ?? '',
    roundProgrammeId: p.roundProgrammeId ?? '',
    deliveryArea: p.deliveryArea ?? '',
    contactEmail: p.contactEmail ?? '',
    amountSought: p.amountSought ?? '',
    proposedPurpose: p.proposedPurpose ?? '',
    proposedImpactQuantity: p.proposedImpactQuantity ?? '',
    note: '',
  }
}
