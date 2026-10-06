import { createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { Alert02Icon, CheckListIcon, MailSend01Icon, NoteIcon } from '@hugeicons/core-free-icons'
import { decideEoi, getEoi, inviteEoiToApply, setEoiProgramme } from '../../server/fns/eois'
import { listProgrammes } from '../../server/fns/programmes'
import { listMyRounds } from '../../server/fns/rounds'
import { EoiProgressDialog } from '../../components/eois/EoiProgressDialog'
import { orNotFound } from '../../lib/loader'
import {
  Button,
  ConfirmDialog,
  DetailHeader,
  ErrorNote,
  KeyFact,
  Panel,
  PanelTitle,
  Select,
  TextLink,
} from '../../components/ui'
import { C } from '../../components/ui/tokens'
import { OutreachDialog } from '../../components/sourcing/OutreachDialog'
import { parseApplicationsSearch } from '../../lib/listSearch'
import { fmtAmount, fmtDate, fmtRef } from '../../lib/format'
import { useAction } from '../../lib/useAction'
import { messageFor } from '../../lib/errors'
import { EOI_STATUS_META, type EoiStatus } from '../../lib/eois/status'

// ─── One expression of interest ──────────────────────────────────────────────
//
// What the organisation sent, in their words and their order, and the one decision it
// asks for: invite them to make a full application, or not.
//
// A page rather than a dialog for the reason a partnership is one: it needs an address.
// The Partnerships pipeline links here ("their EOI arrived"), and "have a look at this
// before Thursday" is a message somebody sends about this screen.
//
// It is deliberately thin beside an application. There is no score, no due diligence
// panel and no votes: an EOI is a letter of introduction, and the checks run on the
// application it leads to. Building them here would be a second pipeline doing the first
// one's job a stage early, on a fraction of the evidence.

export const Route = createFileRoute('/_authenticated/applications/eois/$eoiId')({
  // The Applications card's state, carried in so the back arrow returns to it as read.
  validateSearch: parseApplicationsSearch,
  // Behind the `sourcing` flag, as Partnerships is: see `routes/_authenticated/partnerships.tsx`.
  beforeLoad: ({ context }) => {
    if (!context.user.features.sourcing) throw notFound()
  },
  loader: async ({ params }) => {
    const [eoi, programmes, rounds] = await Promise.all([
      orNotFound(getEoi({ data: { id: params.eoiId } })),
      listProgrammes(),
      // For "Progress to shortlist", which needs a round unless a partnership chose one.
      listMyRounds(),
    ])
    return { eoi, programmes, rounds }
  },
  component: EoiDetail,
})

const STATUS_HEX: Record<EoiStatus, string> = {
  submitted: C.warning,
  invited_to_apply: C.success,
  declined: C.sub,
  applied: C.success,
}

function EoiDetail() {
  const router = useRouter()
  const { user } = Route.useRouteContext()
  const { eoi, programmes, rounds } = Route.useLoaderData()
  const navigate = Route.useNavigate()
  const listSearch = Route.useSearch()
  const canManage = ['superadmin', 'admin'].includes(user.role)

  const [inviting, setInviting] = useState(false)
  const [progressing, setProgressing] = useState(false)
  const [declining, setDeclining] = useState(false)
  const decide = useAction(decideEoi)
  const place = useAction(setEoiProgramme)

  const meta = EOI_STATUS_META[eoi.status]
  const refresh = () => router.invalidate()

  async function invite(
    send: null | { to: string; subject: string; body: string; formUrl: string | null },
  ) {
    await inviteEoiToApply({
      data: {
        id: eoi.id,
        send: send !== null,
        to: send?.to ?? null,
        subject: send?.subject ?? null,
        body: send?.body ?? null,
        formUrl: send?.formUrl ?? null,
      },
    })
    setInviting(false)
    await refresh()
  }

  const subline = [
    eoi.programme?.name ?? 'Not placed in a programme',
    eoi.partnership ? 'From a partnership' : 'Open call',
    `Received ${fmtDate(eoi.createdAt)}`,
    fmtRef(eoi.reference),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex flex-col gap-4">
      <DetailHeader
        // Back to the Applications card on its EOI view, for the programme it was opened
        // from (or this EOI's own programme when it was opened from somewhere else).
        backTo="/applications"
        backSearch={{
          ...listSearch,
          programmeId: listSearch.programmeId ?? eoi.programmeId ?? undefined,
          view: 'eois',
        }}
        backLabel="Back to expressions of interest"
        name={eoi.organisationName}
        subline={subline}
        status={{ label: meta.label, colour: STATUS_HEX[eoi.status], tone: 'toned' }}
        actions={
          canManage && (
            <>
              {meta.actions.includes('invite') && (
                <Button icon={MailSend01Icon} onClick={() => setInviting(true)}>
                  Invite to apply
                </Button>
              )}
              {meta.actions.includes('shortlist') && (
                <Button
                  variant={meta.actions.includes('invite') ? 'secondary' : 'primary'}
                  icon={CheckListIcon}
                  onClick={() => setProgressing(true)}
                >
                  Shortlist
                </Button>
              )}
              {/* Already invited: the same dialog, as a chase. */}
              {eoi.status === 'invited_to_apply' && !eoi.application && (
                <Button variant="secondary" icon={MailSend01Icon} onClick={() => setInviting(true)}>
                  Send the invitation again
                </Button>
              )}
              {meta.actions.includes('decline') && (
                <Button
                  variant="dangerGhost"
                  icon={Alert02Icon}
                  disabled={decide.pending}
                  onClick={() => setDeclining(true)}
                >
                  Not taking forward
                </Button>
              )}
              {meta.actions.includes('reopen') && (
                <Button
                  variant="secondary"
                  icon={NoteIcon}
                  disabled={decide.pending}
                  onClick={async () => {
                    const ok = await decide.run({ data: { id: eoi.id, action: 'reopen' } })
                    if (ok) await refresh()
                  }}
                >
                  Reopen
                </Button>
              )}
            </>
          )
        }
      />

      <ErrorNote error={decide.error} />
      <ErrorNote error={place.error} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <p
            className="rounded-card px-4 py-3 font-display text-body"
            style={{ backgroundColor: C.brandWash, color: C.body }}
          >
            {eoi.application
              ? 'Their application has arrived, and it carries the story from here.'
              : meta.description}
            {eoi.decisionNote ? ` ${eoi.decisionNote}` : ''}
          </p>

          {/* The EOI as SENT: every answer, in the wording and order of the
              foundation's own form. The same `{label, value}` shape an application's
              responses use, drawn the same way. */}
          <Panel label="Their expression of interest">
            <PanelTitle
              right={
                <span className="font-display text-label" style={{ color: C.sub }}>
                  Received {fmtDate(eoi.createdAt)}
                </span>
              }
            >
              Their expression of interest
            </PanelTitle>
            {eoi.responses.length > 0 ? (
              <dl className="flex flex-col gap-4">
                {eoi.responses.map((r, i) => (
                  <div key={i}>
                    <dt
                      className="font-display text-label uppercase tracking-wide"
                      style={{ color: C.faint }}
                    >
                      {r.label}
                    </dt>
                    <dd
                      className="mt-1 whitespace-pre-wrap font-display text-body"
                      style={{ color: C.body }}
                    >
                      {r.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="font-display text-body" style={{ color: C.sub }}>
                The form arrived with no answers.
              </p>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel label="Details">
            <PanelTitle>Details</PanelTitle>
            {/* The one thing about an EOI an admin can change: which programme it is
                filed under. Its form may not have said, or may have said it in words
                nothing here could match. */}
            {canManage ? (
              <div className="mb-4">
                <p
                  className="mb-1 font-display text-label uppercase tracking-wide"
                  style={{ color: C.faint }}
                >
                  Programme
                </p>
                <Select
                  aria-label="Programme"
                  options={programmes.map((p) => ({ value: p.id, label: p.name }))}
                  value={eoi.programmeId ?? undefined}
                  placeholder="Not placed"
                  disabled={place.pending}
                  onChange={async (value) => {
                    const ok = await place.run({
                      data: { id: eoi.id, programmeId: value || null },
                    })
                    if (ok) await refresh()
                  }}
                />
              </div>
            ) : (
              <div className="mb-4">
                <KeyFact label="Programme" value={eoi.programme?.name ?? 'Not placed'} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <KeyFact label="Charity no." value={eoi.charityNumber ?? '--'} />
              <KeyFact label="Company no." value={eoi.companyNumber ?? '--'} />
              <KeyFact
                label="Indicative amount"
                value={eoi.amountIndicative ? fmtAmount(eoi.amountIndicative) : '--'}
                sub={eoi.amountIndicative ? 'Not a commitment' : undefined}
              />
              <KeyFact label="Reference" value={eoi.reference ?? '--'} />
            </div>
            {eoi.contactEmail && (
              <div className="mt-4">
                <p
                  className="font-display text-label uppercase tracking-wide"
                  style={{ color: C.faint }}
                >
                  Contact email
                </p>
                <a
                  href={`mailto:${eoi.contactEmail}`}
                  className="mt-0.5 block break-all font-display text-body font-medium hover:underline"
                  style={{ color: C.brand }}
                >
                  {eoi.contactEmail}
                </a>
              </div>
            )}
          </Panel>

          {eoi.partnership && (
            <Panel label="Where this came from">
              <PanelTitle>Where this came from</PanelTitle>
              <p className="font-display text-body" style={{ color: C.body }}>
                You invited them to send this.{' '}
                <TextLink
                  to="/partnerships/$partnershipId"
                  params={{ partnershipId: eoi.partnership.id }}
                >
                  See the partnership
                </TextLink>
                {eoi.partnership.source ? ` (${eoi.partnership.source.toLowerCase()})` : ''}.
              </p>
            </Panel>
          )}

          {eoi.application && (
            <Panel label="What this became">
              <PanelTitle>What this became</PanelTitle>
              <p className="font-display text-body" style={{ color: C.body }}>
                <TextLink
                  to="/applications/$applicationId"
                  params={{ applicationId: eoi.application.id }}
                >
                  Their application
                </TextLink>{' '}
                has arrived.
              </p>
            </Panel>
          )}
        </div>
      </div>

      {inviting && (
        <OutreachDialog
          kind="apply_invite"
          organisationName={eoi.organisationName}
          defaultTo={eoi.contactEmail}
          contactName={null}
          programmeName={eoi.programme?.name ?? null}
          sender={eoi.sender}
          onClose={() => setInviting(false)}
          onSend={(values) => invite(values)}
          onMarkSent={eoi.status === 'invited_to_apply' ? undefined : () => invite(null)}
        />
      )}

      {progressing && (
        <EoiProgressDialog
          eoi={{
            ...eoi,
            partnershipRoundProgrammeId: eoi.partnership?.roundProgrammeId ?? null,
          }}
          rounds={rounds}
          onClose={() => setProgressing(false)}
          onDone={(applicationId) => {
            setProgressing(false)
            // Onto the application: it is the record now, and the next thing anybody
            // does is read it or vote on it.
            navigate({ to: '/applications/$applicationId', params: { applicationId } })
          }}
        />
      )}

      <ConfirmDialog
        open={declining}
        title="Not taking this forward?"
        confirmLabel="Not taking forward"
        busyLabel="Closing…"
        busy={decide.pending}
        error={decide.error ? messageFor(decide.error) : undefined}
        onCancel={() => setDeclining(false)}
        onConfirm={async () => {
          const ok = await decide.run({ data: { id: eoi.id, action: 'decline' } })
          if (!ok) return
          setDeclining(false)
          await refresh()
        }}
      >
        <p>
          {eoi.organisationName} is moved to Decided. Nobody is emailed: if you want to let them
          know, that is yours to send. You can reopen it at any time.
        </p>
      </ConfirmDialog>
    </div>
  )
}
