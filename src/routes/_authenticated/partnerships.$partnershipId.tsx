import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import {
  Alert02Icon,
  ArchiveIcon,
  CheckmarkCircle02Icon,
  NoteIcon,
  PencilEdit02Icon,
  SearchList01Icon,
} from '@hugeicons/core-free-icons'
import {
  actOnPartnership,
  addPartnershipNote,
  getPartnership,
  screenPartnership,
  setPartnershipArchived,
} from '../../server/fns/partnerships'
import { listClientTags, listProgrammes } from '../../server/fns/programmes'
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
import { fmtAmount, fmtDate, fmtRef } from '../../lib/format'
import { useAction } from '../../lib/useAction'
import { messageFor } from '../../lib/errors'
import {
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
// due diligence result that arrives from two external registers, an EOI submission, and
// eventually a link to the application it produced. Three further things settle it:
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
    const [partnership, programmes, clientTags] = await Promise.all([
      orNotFound(getPartnership({ data: { id: params.partnershipId } })),
      listProgrammes(),
      listClientTags(),
    ])
    return { partnership, programmes, clientTags }
  },
  component: PartnershipDetail,
})

const STATUS_HEX: Record<string, string> = {
  prospective: C.sub,
  eoi_issued: C.info,
  eoi_received: C.warning,
  invited: C.success,
  declined: C.danger,
}

/**
 * A TICK on the two "mark as" actions, not an envelope. An envelope beside "Mark EOI as
 * sent" reads as a send button — which is the promise this screen no longer makes, and
 * made once too often (see `run`).
 */
const ACTION_ICON: Record<PartnershipAction, typeof Alert02Icon> = {
  issue_eoi: CheckmarkCircle02Icon,
  invite: CheckmarkCircle02Icon,
  decline: Alert02Icon,
  reopen: NoteIcon,
}

function PartnershipDetail() {
  const router = useRouter()
  const { user } = Route.useRouteContext()
  const { partnership, programmes, clientTags } = Route.useLoaderData()
  const listSearch = Route.useSearch()
  const canManage = ['superadmin', 'admin'].includes(user.role)

  const [draft, setDraft] = useState<PartnershipDraft | undefined>()
  const [confirm, setConfirm] = useState<PartnershipAction | undefined>()
  const [archiving, setArchiving] = useState(false)
  const [note, setNote] = useState('')

  const act = useAction(actOnPartnership)
  const screen = useAction(screenPartnership)
  const archive = useAction(setPartnershipArchived)
  const postNote = useAction(addPartnershipNote)

  const meta = PARTNERSHIP_STATUS_META[partnership.status]
  const screenable = canScreen(partnership.charityNumber, partnership.companyNumber)

  const subline = [
    partnership.organisationType,
    partnership.location,
    fmtRef(partnership.reference),
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
   * **Custodian sends nothing here, and nothing here pretends it did.** These buttons
   * used to open the admin's mail client on a `mailto:` and move the status in the same
   * gesture — which meant closing the draft without sending still left the record
   * saying "an expression-of-interest form has gone out". A `mailto:` is handed to the
   * operating system and never reports back: no success, no failure, no callback. There
   * is no version of that flow in which the app can know.
   *
   * So the verbs are "Mark … as sent" and "Mark as invited", and pressing one is the
   * ADMIN's statement that they did it — the same kind of fact as "introduced by James
   * Hartley at the May board dinner", which is what every other entry in this module's
   * history already is. `finance_digest_sends` states the underlying rule: a record of
   * a send is a receipt, written when something is known to have gone, never a claim
   * written in the hope that it did.
   *
   * If Custodian ever does send the EOI — a hosted form emailed through Resend, as
   * award letters go — that becomes a real receipt (`sent`/`failed` on the row) and
   * this collapses back to one click that has earned its wording.
   */
  async function run(action: PartnershipAction) {
    const result = await act.run({ data: { id: partnership.id, action } })
    if (!result) return
    setConfirm(undefined)
    await refresh()
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
              {meta.actions.map((action, i) => {
                const a = PARTNERSHIP_ACTION_META[action]
                return (
                  <Button
                    key={action}
                    // Destructive is checked FIRST, not after the position. On an
                    // invited partnership the only remaining move is "Not pursuing",
                    // which made it index 0 and drew closing a relationship as the
                    // solid green primary button on the screen.
                    variant={a.destructive ? 'dangerGhost' : i === 0 ? 'primary' : 'secondary'}
                    icon={ACTION_ICON[action]}
                    disabled={act.pending}
                    // Declining is the one move that closes a relationship somebody
                    // spent effort on, so it asks first. The rest are reversible by
                    // their own opposite and are not worth a dialog.
                    onClick={() => (a.destructive ? setConfirm(action) : run(action))}
                  >
                    {a.label}
                  </Button>
                )
              })}
              <ActionMenu
                label={`Actions for ${partnership.organisationName}`}
                actions={[
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

      {partnership.archivedAt && (
        <Panel label="Archive" className="border-warning/30 bg-warning/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-display text-body" style={{ color: C.body }}>
              Archived {fmtDate(partnership.archivedAt)}
              {partnership.archiveNote ? ` — ${partnership.archiveNote}` : ''}
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

          {partnership.eoiResponses && partnership.eoiResponses.length > 0 && (
            <Panel label="Expression of interest">
              <PanelTitle
                right={
                  partnership.eoiReceivedAt ? (
                    <span className="font-display text-label" style={{ color: C.sub }}>
                      Received {fmtDate(partnership.eoiReceivedAt)}
                    </span>
                  ) : undefined
                }
              >
                Expression of interest
              </PanelTitle>
              {/* The same `{label, value}` shape an application's responses use, drawn
                  the same way — a foundation reading both should not have to learn two
                  layouts for the same thing. */}
              <dl className="flex flex-col gap-4">
                {partnership.eoiResponses.map((r, i) => (
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
                  placeholder="Add what happened — a call, a visit, a decision taken elsewhere…"
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
              <KeyFact label="Programme" value={partnership.programme?.name ?? 'Not decided'} />
              <KeyFact label="Source" value={partnership.source ?? '—'} />
              <KeyFact label="Charity no." value={partnership.charityNumber ?? '—'} />
              <KeyFact label="Company no." value={partnership.companyNumber ?? '—'} />
              <KeyFact label="Contact" value={partnership.contactName ?? '—'} />
              {/* "Indicative", every time it is printed. Nothing in Finance, the annual
                  budget or any meter reads this figure — it is what somebody said over
                  coffee, and the money rule (CLAUDE.md) is that a conversation is not
                  money committed. Labelling it anything shorter is how it ends up in a
                  total. */}
              <KeyFact
                label="Indicative ask"
                value={
                  partnership.amountSought ? fmtAmount(partnership.amountSought) : 'Not discussed'
                }
                sub={partnership.amountSought ? 'Not a commitment' : undefined}
              />
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
                  Themes
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

          {/* Where the pipeline hands over. Once an invited organisation applies, the
              application is the record of the ask and this stops moving — so the last
              thing the screen says is what it turned into. */}
          {partnership.application && (
            <Panel label="What this became">
              <PanelTitle>What this became</PanelTitle>
              <p className="font-display text-body" style={{ color: C.body }}>
                <TextLink
                  to="/applications/$applicationId"
                  params={{ applicationId: partnership.application.id }}
                >
                  {partnership.application.organisationName}
                </TextLink>{' '}
                applied.
              </p>
            </Panel>
          )}
        </div>
      </div>

      <PartnershipDialog
        open={draft !== undefined}
        draft={draft}
        programmes={programmes.map((p) => ({ id: p.id, name: p.name }))}
        themeSuggestions={clientTags}
        onClose={() => setDraft(undefined)}
        onSaved={async () => {
          setDraft(undefined)
          await refresh()
        }}
      />

      <ConfirmDialog
        open={confirm !== undefined}
        title="Not pursuing this partnership?"
        confirmLabel="Not pursuing"
        busyLabel="Closing…"
        busy={act.pending}
        error={act.error ? messageFor(act.error) : undefined}
        onCancel={() => setConfirm(undefined)}
        onConfirm={() => confirm && run(confirm)}
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
    reference: p.reference ?? '',
    organisationType: p.organisationType ?? '',
    location: p.location ?? '',
    charityNumber: p.charityNumber ?? '',
    companyNumber: p.companyNumber ?? '',
    source: p.source ?? '',
    programmeId: p.programmeId ?? '',
    tags: p.tags ?? [],
    contactName: p.contactName ?? '',
    contactEmail: p.contactEmail ?? '',
    amountSought: p.amountSought ?? '',
    note: '',
  }
}
