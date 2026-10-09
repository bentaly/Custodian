import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import {
  Alert02Icon,
  ArchiveIcon,
  Building02Icon,
  Coins01Icon,
  Location01Icon,
  MoneyReceive01Icon,
  UserGroupIcon,
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
  BreadcrumbBar,
  Button,
  ClampToggle,
  CompactMoney,
  ConfirmDialog,
  DetailHeader,
  ErrorNote,
  KeyFact,
  KPI_TINTS,
  MiniKpi,
  Panel,
  PanelTitle,
  RelatedLink,
  TextLink,
  Textarea,
  ThemePills,
  useClamp,
} from '../../components/ui'
import { HugeiconsIcon } from '@hugeicons/react'
import { AREA_ICON } from '../../components/Sidebar'
import { DueDiligenceChecks, Fact, RegisterCredit } from '../../components/detail/OrganisationParts'
import { charityRegisterUrl, companiesHouseUrl } from '../../lib/dueDiligence'
import { C } from '../../components/ui/tokens'
import { Avatar } from '../../components/ui/Avatar'
import {
  PartnershipDialog,
  type PartnershipDraft,
} from '../../components/partnerships/PartnershipDialog'
import { DD_LABEL, DD_TONE_HEX } from '../../components/partnerships/dueDiligenceTone'
import { parsePartnershipsSearch } from '../../lib/listSearch'
import { fmtAmount, fmtDate, fmtDuration, fmtMoney, fmtPerYear } from '../../lib/format'
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
  // The application header's order: programme, number, area, round, then what only a
  // partnership has.
  const subline = [
    partnership.programme?.name ?? 'No programme chosen',
    partnership.charityNumber
      ? `Charity no. ${partnership.charityNumber}`
      : partnership.companyNumber
        ? `Company no. ${partnership.companyNumber}`
        : null,
    partnership.deliveryArea,
    partnership.roundProgramme ? `${partnership.roundProgramme.round.name} round` : null,
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

  // The organisation, as the register has it. The same cells, in the same order, as the
  // organisation card on an application, so a partner reads as the application it will
  // become.
  const profile = partnership.organisationProfile
  const fromCompaniesHouse = profile?.source === 'companies_house'
  const registerName = fromCompaniesHouse ? 'Companies House' : 'Charity Commission'
  const registerUrl = fromCompaniesHouse
    ? companiesHouseUrl(profile?.companyNumber)
    : charityRegisterUrl(profile?.organisationNumber)
  const income = profile?.latestIncome ?? null
  const periodEnd = profile?.financialPeriodEnd ? fmtDate(profile.financialPeriodEnd) : null
  const registered =
    [
      profile?.registeredSince
        ? `${fromCompaniesHouse ? '' : 'Registered '}${new Date(profile.registeredSince).getFullYear()}`
        : null,
      profile?.charityType ?? profile?.companyType,
    ]
      .filter(Boolean)
      .join(' · ') || null
  const people =
    [
      profile?.employees != null ? `${profile.employees.toLocaleString('en-GB')} staff` : null,
      profile?.volunteers != null
        ? `${profile.volunteers.toLocaleString('en-GB')} volunteers`
        : null,
      profile?.directorCount != null
        ? `${profile.directorCount} director${profile.directorCount === 1 ? '' : 's'}`
        : null,
    ]
      .filter(Boolean)
      .join(' · ') || null
  const accounts = profile?.lastAccountsMadeUpTo
    ? [`Year to ${fmtDate(profile.lastAccountsMadeUpTo)}`, profile.lastAccountsType]
        .filter(Boolean)
        .join(' · ')
    : null
  const nature = profile?.natureOfBusiness?.length ? profile.natureOfBusiness.join('; ') : null
  const activities = useClamp(profile?.activities)
  const profileAbsence = !screenable
    ? 'No charity or company number is on record, so there is no register entry to read.'
    : partnership.dueDiligenceCheckedAt
      ? 'The register was checked before Custodian kept its own figures. Re-run screening to read them.'
      : 'Not read yet. Run screening to read the register.'

  const unitLabel = impactUnitLabel(programme?.impactUnit, programme?.impactUnitLabel)
  const amount = partnership.amountSought ? Number(partnership.amountSought) : null
  const impact = partnership.proposedImpactQuantity
    ? Number(partnership.proposedImpactQuantity)
    : null
  const costEach = amount && impact && impact > 0 ? amount / impact : null

  // The round-programme from the rounds list, which carries what the shortlist dialog
  // needs (the grant duration, the round's year, the impact unit).
  const roundProgramme =
    rounds
      .flatMap((round) => round.roundProgrammes.map((rp) => ({ ...rp, round })))
      .find((rp) => rp.id === partnership.roundProgrammeId) ?? null
  const years = roundProgramme?.grantDurationYears ?? null

  const ddRecords = partnership.dueDiligenceChecks ?? []

  return (
    <div className="flex flex-col gap-4">
      {/* As on an application: the trail back, and the record this one became. */}
      <BreadcrumbBar
        items={[
          { label: 'Partnerships', to: '/partnerships', search: listSearch },
          { label: partnership.organisationName },
        ]}
        related={
          partnership.application ? (
            <RelatedLink
              to="/applications/$applicationId"
              params={{ applicationId: partnership.application.id }}
              icon={AREA_ICON['/applications']}
            >
              Application
            </RelatedLink>
          ) : undefined
        }
      />
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
                // round was required say so on the grant purpose panel instead.
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

      {/* What this state MEANS, in a sentence. A pipeline status is a word whose
          consequence is not obvious ("EOI sent" — so is there anything for me to do?). */}
      <p
        className="rounded-card px-4 py-3 font-display text-body"
        style={{ backgroundColor: C.brandWash, color: C.body }}
      >
        {meta.description}
      </p>

      {/* The application's opening panel, in the same two columns: what the money would
          fund beside who is asking. Here the purpose is what staff logged rather than a
          summary of a form, and the caption says so. */}
      <Panel label="grant purpose">
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
          <div className="flex flex-col">
            <p
              className="font-display text-label font-medium uppercase"
              style={{ color: C.sub, letterSpacing: '0.06em' }}
            >
              Grant purpose
            </p>
            {partnership.proposedPurpose ? (
              <p
                className="mt-2 whitespace-pre-wrap border-l-3 pl-2 font-display text-title leading-normal"
                style={{ color: C.ink, borderColor: C.brand }}
              >
                {partnership.proposedPurpose}
              </p>
            ) : (
              <p
                className="mt-2 border-l-3 pl-2 font-display text-body leading-normal"
                style={{ color: C.sub, borderColor: C.line }}
              >
                No purpose recorded yet. Add one under Edit details.
              </p>
            )}
            {(partnership.tags ?? []).length > 0 && (
              <div className="mt-3">
                <ThemePills themes={partnership.tags ?? []} className="justify-start" />
              </div>
            )}
            {/* A row logged before the round was required. Said here, beside the facts
                the shortlist would be built from, rather than as a missing button. */}
            {!partnership.roundProgrammeId && !partnership.applicationId && (
              <p className="mt-3 font-display text-label" style={{ color: C.warning }}>
                No round chosen yet, so this partner cannot be taken to the shortlist. Choose one
                under Edit details.
              </p>
            )}
            <p className="mt-3 font-display text-label lg:mt-auto lg:pt-6" style={{ color: C.sub }}>
              As logged{partnership.createdBy ? ` by ${partnership.createdBy.name}` : ''}
            </p>
          </div>

          <div className="rounded-card p-5" style={{ backgroundColor: C.wash }}>
            <div className="flex items-center gap-1.5">
              <HugeiconsIcon icon={Building02Icon} size={14} color={C.sub} />
              <p
                className="font-display text-label font-medium uppercase"
                style={{ color: C.sub, letterSpacing: '0.06em' }}
              >
                The organisation
              </p>
              {activities.clipped && (
                <ClampToggle
                  open={activities.open}
                  onToggle={activities.toggle}
                  label="Read the full description"
                />
              )}
              {profile && (
                <p className="ml-auto font-display text-micro uppercase" style={{ color: C.faint }}>
                  <RegisterCredit url={registerUrl}>{registerName}</RegisterCredit> · read{' '}
                  {fmtDate(profile.fetchedAt)}
                </p>
              )}
            </div>
            {profile?.activities ? (
              <p
                ref={activities.ref}
                className={`mt-2 font-display text-body leading-relaxed ${activities.className ?? ''}`}
                style={{ color: C.ink }}
              >
                {profile.activities}
              </p>
            ) : (
              <p className="mt-2 font-display text-body" style={{ color: C.sub }}>
                {fromCompaniesHouse
                  ? 'Companies House holds no description of what a company does. Its nature of business is below.'
                  : profile
                    ? 'The register holds no activity summary.'
                    : profileAbsence}
              </p>
            )}
            {profile && (
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                <Fact
                  label="Income (last FY)"
                  value={
                    income != null ? <CompactMoney amount={income} label="Exact income" /> : null
                  }
                  empty={fromCompaniesHouse ? 'not published by Companies House' : 'not captured'}
                  note={periodEnd ? `year to ${periodEnd}` : null}
                />
                {/* No register publishes reserves; on an application they come from the
                    form, and there is no form yet. Asked when it is shortlisted. */}
                <Fact label="Unrestricted reserves" value={null} empty="asked when shortlisted" />
                {registered && (
                  <Fact
                    label={fromCompaniesHouse ? 'Incorporated' : 'Registered'}
                    value={registered}
                  />
                )}
                {people && <Fact label="People" value={people} />}
                {fromCompaniesHouse && (
                  <Fact
                    label="Last accounts filed"
                    value={accounts}
                    empty="none filed yet"
                    note={profile.accountsOverdue ? 'next accounts overdue' : null}
                  />
                )}
                {nature && (
                  <div className="col-span-2">
                    <Fact label="Nature of business" value={nature} />
                  </div>
                )}
              </dl>
            )}
          </div>
        </div>
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

      {/* The application's figure row, with what a partnership has: no amount proposed
          (the value IS the proposal) and no budget, since there is no form. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
        <MiniKpi
          tint={KPI_TINTS.violet}
          icon={Coins01Icon}
          label="Grant value proposed"
          value={amount != null ? fmtMoney(amount) : '--'}
          sub={
            amount != null
              ? (fmtPerYear(amount, years) ?? fmtDuration(years) ?? 'Not a commitment')
              : 'not stated'
          }
        />
        <MiniKpi
          tint={KPI_TINTS.amber}
          icon={UserGroupIcon}
          label="Beneficiaries"
          value={impact != null ? `~${impact.toLocaleString('en-GB')}` : '--'}
          sub={
            impact != null
              ? `${unitLabel.toLowerCase()}${costEach != null ? ` · ${fmtMoney(costEach)} each` : ''}`
              : 'not stated'
          }
        />
        <MiniKpi
          tint={KPI_TINTS.pink}
          icon={MoneyReceive01Icon}
          label="Income (last FY)"
          value={income != null ? <CompactMoney amount={income} label="Exact income" /> : '--'}
          sub={
            income != null
              ? periodEnd
                ? `year to ${periodEnd}`
                : 'per the register'
              : !screenable
                ? 'no charity number'
                : 'not captured'
          }
        />
        <MiniKpi
          tint={KPI_TINTS.sky}
          icon={Location01Icon}
          label="Delivery area"
          value={partnership.deliveryArea ?? '--'}
          sub={partnership.deliveryArea ? 'as logged' : 'not stated'}
        />
      </div>

      {/* Due diligence, drawn as an application draws it. */}
      <Panel label="Due diligence">
        <PanelTitle
          right={
            <span className="flex items-center gap-3">
              <Badge
                className="text-label"
                style={{
                  backgroundColor: `color-mix(in srgb, ${DD_TONE_HEX[partnership.dueDiligenceStatus]} 10%, transparent)`,
                  color: DD_TONE_HEX[partnership.dueDiligenceStatus],
                }}
              >
                {DD_LABEL[partnership.dueDiligenceStatus]}
              </Badge>
              {canManage && screenable && (
                <Button
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
            </span>
          }
        >
          Due diligence checks
        </PanelTitle>
        {/* The one dead end screening has: with both numbers NULL there is nothing to
            check, so the panel says so and points at the fix. */}
        {!screenable ? (
          <p className="font-display text-body" style={{ color: C.sub }}>
            No charity or company number on record, so there is nothing to screen against. Add one
            under Edit details and it will screen on the spot.
          </p>
        ) : ddRecords.length > 0 ? (
          <>
            <DueDiligenceChecks records={ddRecords} rememberAs="partnership.dd-passed" />
            {partnership.dueDiligenceCheckedAt && (
              <p className="mt-2 font-display text-label" style={{ color: C.faint }}>
                Last run {fmtDate(partnership.dueDiligenceCheckedAt)}
              </p>
            )}
          </>
        ) : (
          <p className="font-display text-body" style={{ color: C.sub }}>
            Not screened yet.
          </p>
        )}
      </Panel>

      {/* The relationship history — the panel this record exists for, and the one thing
          an application has no equivalent of. Written in sentences, because what a
          grants officer needs from it is the story, not a diff. */}
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
                  {/* The DATE, not the minute: `occurred_at` is often a date somebody
                      typed weeks later. */}
                  <span className="font-display text-label" style={{ color: C.faint }}>
                    {event.actor?.name ?? 'Custodian'} · {fmtDate(event.occurredAt)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      {/* What only a partnership has, two up beneath the record: where it stands with
          the foundation and what it led to. */}
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel label="Details">
          <PanelTitle>Details</PanelTitle>
          <div className="grid grid-cols-2 gap-4">
            <KeyFact label="Round" value={partnership.roundProgramme?.round.name ?? '--'} />
            <KeyFact label="Programme" value={partnership.programme?.name ?? '--'} />
            <KeyFact label="Source" value={partnership.source ?? '--'} />
            <KeyFact label="Logged" value={fmtDate(partnership.createdAt)} />
            <KeyFact label="Charity no." value={partnership.charityNumber ?? '--'} />
            <KeyFact label="Company no." value={partnership.companyNumber ?? '--'} />
          </div>
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
        </Panel>

        {/* Have we met them before. Numbers only (see `partnerships/history.ts`). */}
        {(partnership.history.awards.length > 0 || partnership.history.partnerships.length > 0) && (
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
                  <TextLink to="/partnerships/$partnershipId" params={{ partnershipId: other.id }}>
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

        {/* Their expression of interest: the submission lives with every other EOI. */}
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

        {/* Offered, never assumed: an application with the same number is probably theirs. */}
        {canManage && !partnership.application && partnership.applicationCandidates.length > 0 && (
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
          context={{
            roundProgramme,
            financialYearEndMonth: partnership.financialYearEndMonth,
            income:
              income != null
                ? { amount: income, periodEnd: profile?.financialPeriodEnd ?? null }
                : null,
            incomeNote: fromCompaniesHouse
              ? 'Companies House does not publish income.'
              : 'Read from the charity register once due diligence has run.',
          }}
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
