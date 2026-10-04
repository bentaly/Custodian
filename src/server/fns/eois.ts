import { badRequest, conflict, forbidden, notFoundError } from '../../lib/errors'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm'
import { getDb } from '../db'
import { features, requireFeature } from '../features'
import { searchAny } from '../searchTerm'
import { anyOf } from '../filterSql'
import {
  applications,
  eois,
  partnershipEvents,
  partnerships,
  programmes,
} from '../../../drizzle/schema'
import { enqueue } from '../pipelineQueue'
import { scoreApplication } from '../applications/score'
import { sourcedApplicationValues } from '../sourcing/application'
import { requireAuthUser, requireRole } from '../session'
import { assertClientAccess } from '../scope'
import { facetBy, type FacetOption } from '../../lib/facets'
import { clampPage, PAGE_SIZE } from '../../lib/pagination'
import { sendAwardLetterEmail } from '../../lib/email'
import { withInviteRef } from '../../lib/sourcing/inviteRef'
import { renderOutreach } from '../../lib/sourcing/outreach'
import { canTransition } from '../../lib/partnerships/status'
import {
  canDecideEoi,
  EOI_ACTION_TO,
  EOI_STATUS_META,
  EOI_TABS,
  type EoiStatus,
  type EoiTab,
} from '../../lib/eois/status'
import {
  DecideEoiSchema,
  InviteEoiSchema,
  ProgressEoiSchema,
  SetEoiProgrammeSchema,
} from '../../lib/validators/eoi'

// ─── Expressions of interest ─────────────────────────────────────────────────
//
// **Tenancy is `eois.client_id`, filtered directly**, for the reason
// `fns/partnerships.ts` gives: an EOI has no round-programme, so
// `visibleRoundProgrammeIds` has nothing to scope it by. Every read filters on it and
// every write re-checks it with `assertClientAccess`.
//
// Reads are open to every role in the foundation, as applications are. Writes are
// admin-only: who is invited to apply is the same executive decision as who is invited
// at all.
//
// Nothing here moves money or writes to `audit_log`. An EOI commits nothing; the
// decision that matters is made later, on the application it may lead to.

/**
 * Does this foundation use EOIs, and how many are waiting?
 *
 * Decides whether Applications offers its EOI tab: shown whenever a live programme is
 * switched on to take them (`programmes.accepts_eois`), empty or not, so a foundation
 * that has just set up its form can see where they will arrive.
 */
export const getEoiNav = createServerFn({ method: 'GET' }).handler(async () => {
  // Asked by Applications on every deployment, so it answers "not in use" rather than
  // refusing where the feature is off.
  if (!features().sourcing) return { enabled: false, toReview: 0 }
  const user = await requireAuthUser()
  if (!user.clientId) return { enabled: false, toReview: 0 }
  const db = getDb()
  const [programmeRows, waiting] = await Promise.all([
    db
      .select({ n: count() })
      .from(programmes)
      .where(
        and(
          eq(programmes.clientId, user.clientId),
          eq(programmes.acceptsEois, true),
          isNull(programmes.archivedAt),
        ),
      ),
    db
      .select({ n: count() })
      .from(eois)
      .where(and(eq(eois.clientId, user.clientId), eq(eois.status, 'submitted'))),
  ])
  return {
    enabled: (programmeRows[0]?.n ?? 0) > 0,
    toReview: waiting[0]?.n ?? 0,
  }
})

const FiltersSchema = z
  .object({
    tab: z.enum(['to_review', 'decided']).optional(),
    programmeId: z.array(z.string()).min(1).max(500).optional(),
    q: z.string().optional(),
    page: z.number().int().positive().optional(),
  })
  .optional()

const LIST_WITH = {
  programme: { columns: { id: true, name: true, colour: true } },
  partnership: { columns: { id: true } },
  application: { columns: { id: true, status: true } },
} as const

function listRows(where: ReturnType<typeof and>, offset: number) {
  return getDb().query.eois.findMany({
    where,
    with: LIST_WITH,
    // Rows only: the answers are read on the EOI's own screen, and a list page of
    // twenty-five full submissions is most of a megabyte nobody looks at.
    columns: { responses: false, rawPayload: false },
    orderBy: [desc(eois.createdAt)],
    offset,
    limit: PAGE_SIZE,
  })
}
export type EoiRow = Awaited<ReturnType<typeof listRows>>[number]

/** The EOI list. Tab counts reflect the other filters, as on every list. */
export const listEois = createServerFn({ method: 'GET' })
  .validator(FiltersSchema)
  .handler(async ({ data }) => {
    requireFeature('sourcing')
    const user = await requireAuthUser()
    const filters = data ?? {}
    const tab: EoiTab = filters.tab ?? 'to_review'
    if (!user.clientId) {
      return {
        items: [] as EoiRow[],
        total: 0,
        page: 1,
        pageSize: PAGE_SIZE,
        tabCounts: { to_review: 0, decided: 0 },
        facets: { programmes: [] as FacetOption[] },
      }
    }

    const db = getDb()
    const scope = eq(eois.clientId, user.clientId)
    const baseWhere = and(
      scope,
      anyOf(eois.programmeId, filters.programmeId),
      searchAny(filters.q, eois.organisationName, eois.reference, eois.contactEmail),
    )
    const statuses = EOI_TABS.find((t) => t.id === tab)!.statuses
    const where = and(baseWhere, inArray(eois.status, statuses))
    const page = clampPage(filters.page, Number.MAX_SAFE_INTEGER)

    const [rows, totals, statusRows, facetRows] = await Promise.all([
      listRows(where, (page - 1) * PAGE_SIZE),
      db.select({ total: count() }).from(eois).where(where),
      db
        .select({ status: eois.status, n: count() })
        .from(eois)
        .where(baseWhere)
        .groupBy(eois.status),
      // Off the whole tenant, before the transient filters (`lib/facets`).
      db
        .select({ id: programmes.id, name: programmes.name })
        .from(eois)
        .innerJoin(programmes, eq(eois.programmeId, programmes.id))
        .where(scope),
    ])

    const countFor = (id: EoiTab) =>
      EOI_TABS.find((t) => t.id === id)!.statuses.reduce(
        (sum, s) => sum + (statusRows.find((r) => r.status === s)?.n ?? 0),
        0,
      )

    return {
      items: rows,
      total: totals[0]?.total ?? 0,
      page,
      pageSize: PAGE_SIZE,
      tabCounts: { to_review: countFor('to_review'), decided: countFor('decided') },
      facets: { programmes: facetBy(facetRows, (r) => ({ value: r.id, label: r.name })) },
    }
  })

/** One EOI: every answer, where it sits, what it came from and what it became. */
export const getEoi = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    requireFeature('sourcing')
    const user = await requireAuthUser()
    const db = getDb()
    const row = await db.query.eois.findFirst({
      where: (e, { eq }) => eq(e.id, data.id),
      // The raw payload stays on the server: `responses` is the same answers in the
      // order they were asked, and the payload also holds the invitation reference.
      columns: { rawPayload: false },
      with: {
        programme: { columns: { id: true, name: true, colour: true } },
        partnership: {
          columns: { id: true, organisationName: true, source: true, roundProgrammeId: true },
        },
        application: { columns: { id: true, status: true, organisationName: true } },
        decidedBy: { columns: { id: true, name: true } },
      },
    })
    if (!row) throw notFoundError()
    assertClientAccess(user, row.clientId)

    const client = await db.query.clients.findFirst({
      where: (c, { eq }) => eq(c.id, row.clientId),
      columns: { name: true },
      with: { profile: { columns: { awardLetterSenderName: true, awardLetterReplyTo: true } } },
    })
    return {
      ...row,
      sender: {
        foundationName: client?.name ?? '',
        senderName: client?.profile?.awardLetterSenderName ?? client?.name ?? null,
        replyTo: client?.profile?.awardLetterReplyTo ?? null,
      },
    }
  })

/** Load an EOI for a write, proving the caller may act on it. */
async function forWrite(id: string, user: { role: string; clientId: string | null }) {
  const existing = await getDb().query.eois.findFirst({ where: (e, { eq }) => eq(e.id, id) })
  if (!existing) throw notFoundError()
  assertClientAccess(user, existing.clientId)
  return existing
}

function stale(status: EoiStatus) {
  return conflict(
    `This expression of interest is already “${EOI_STATUS_META[status].label}”. Reload the page to see where it has got to.`,
  )
}

/**
 * Not taking an EOI forward, or putting one back to review.
 *
 * **Nobody is emailed.** Telling an organisation its EOI was unsuccessful is a letter
 * with the same standing as a decline letter, and there is no template or batch for it
 * yet; a status change must not become a message to a third party by the back door.
 */
export const decideEoi = createServerFn({ method: 'POST' })
  .validator(DecideEoiSchema)
  .handler(async ({ data }) => {
    requireFeature('sourcing')
    const user = await requireRole('superadmin', 'admin')
    const existing = await forWrite(data.id, user)
    if (!canDecideEoi(existing.status, data.action)) throw stale(existing.status)
    const to = EOI_ACTION_TO[data.action]
    await getDb()
      .update(eois)
      .set({
        status: to,
        decidedAt: to === 'submitted' ? null : new Date(),
        decidedByUserId: to === 'submitted' ? null : user.id,
        decisionNote: to === 'submitted' ? null : (data.note ?? null),
        updatedAt: new Date(),
      })
      .where(eq(eois.id, existing.id))
    return { status: to }
  })

/**
 * Invite whoever sent an EOI to make a full application.
 *
 * With `send`, Custodian emails the link to the foundation's own application form with
 * the invitation reference (`e_<id>`) on it, so the application that comes back is tied
 * to this EOI (`sourcing/link.ts`); the status moves only once Resend has accepted the
 * message. Without it, the admin is stating they invited them some other way.
 *
 * Where the EOI came from a sourced partner, the partnership is moved to `invited` in
 * the same batch, so the two screens cannot disagree about whether they were asked.
 */
export const inviteEoiToApply = createServerFn({ method: 'POST' })
  .validator(InviteEoiSchema)
  .handler(async ({ data }) => {
    requireFeature('sourcing')
    const user = await requireRole('superadmin', 'admin')
    const db = getDb()
    const existing = await forWrite(data.id, user)
    // A second invitation to one already invited is a chase: it sends and moves nothing.
    const moves = existing.status !== 'invited_to_apply'
    if (moves && !canDecideEoi(existing.status, 'invite')) throw stale(existing.status)

    if (data.send) {
      const link = withInviteRef(data.formUrl!, { kind: 'eoi', id: existing.id })
      if (!link) throw badRequest('That link is not a web address. It should start with https://')
      const client = await db.query.clients.findFirst({
        where: (c, { eq }) => eq(c.id, existing.clientId),
        columns: { name: true },
        with: { profile: { columns: { awardLetterSenderName: true, awardLetterReplyTo: true } } },
      })
      const rendered = renderOutreach('apply_invite', data.body!, link)
      const sent = await sendAwardLetterEmail({
        to: data.to!,
        senderName: client?.profile?.awardLetterSenderName ?? client?.name ?? null,
        replyTo: client?.profile?.awardLetterReplyTo ?? null,
        subject: data.subject!,
        html: rendered.html,
        text: rendered.text,
      })
      if (!sent.ok) {
        throw conflict(
          `The email was not sent, and nothing has changed. ${sent.error ?? ''}`.trim(),
        )
      }
    }

    const note = data.send
      ? `Custodian emailed an invitation to apply to ${data.to}.`
      : 'Marked as invited to apply.'
    const updateEoi = db
      .update(eois)
      .set({
        status: 'invited_to_apply',
        ...(moves ? { decidedAt: new Date(), decidedByUserId: user.id } : {}),
        decisionNote: note,
        ...(data.send && !existing.contactEmail ? { contactEmail: data.to } : {}),
        updatedAt: new Date(),
      })
      .where(eq(eois.id, existing.id))

    const partnership = existing.partnershipId
      ? await db.query.partnerships.findFirst({
          where: and(
            eq(partnerships.id, existing.partnershipId),
            eq(partnerships.clientId, existing.clientId),
          ),
          columns: { id: true, status: true },
        })
      : undefined
    if (!partnership) {
      await updateEoi
      return { status: 'invited_to_apply' as const }
    }
    await db.batch([
      updateEoi,
      db
        .update(partnerships)
        .set({
          ...(canTransition(partnership.status, 'invite') ? { status: 'invited' as const } : {}),
          updatedAt: new Date(),
        })
        .where(eq(partnerships.id, partnership.id)),
      db.insert(partnershipEvents).values({
        partnershipId: partnership.id,
        kind: 'invited',
        body: data.send
          ? `Custodian emailed an invitation to apply to ${data.to}, after their expression of interest.`
          : 'Marked as invited to apply, after their expression of interest.',
        actorUserId: user.id,
      }),
    ])
    return { status: 'invited_to_apply' as const }
  })

/** File an EOI under one of the foundation's programmes, or take it out of one. */
export const setEoiProgramme = createServerFn({ method: 'POST' })
  .validator(SetEoiProgrammeSchema)
  .handler(async ({ data }) => {
    requireFeature('sourcing')
    const user = await requireRole('superadmin', 'admin')
    const db = getDb()
    const existing = await forWrite(data.id, user)
    if (data.programmeId) {
      const [programme] = await db
        .select({ id: programmes.id })
        .from(programmes)
        .where(and(eq(programmes.id, data.programmeId), eq(programmes.clientId, existing.clientId)))
        .limit(1)
      if (!programme) throw notFoundError()
    }
    await db
      .update(eois)
      .set({ programmeId: data.programmeId, updatedAt: new Date() })
      .where(eq(eois.id, existing.id))
    return { ok: true }
  })

/**
 * Take an EOI straight to the shortlist (route 3): the foundation has read enough and
 * wants to fund it without a full application.
 *
 * Built by the same `sourcedApplicationValues` a partnership's direct route uses, with
 * two differences that follow from what an EOI is. Its answers ARE the organisation's own
 * words, so they become the application's responses and the application is scored in its
 * own right, on the ordinary prompt (no `sourced` framing: this is an applicant writing).
 * And nothing has screened it yet, so due diligence runs now.
 *
 * Writes at `for_review`; the dialog then shortlists it through `updateApplicationStatus`,
 * as `progressPartnership` does and for the same reason. A sourced partner's EOI hands
 * its partnership over in the same batch.
 */
export const progressEoi = createServerFn({ method: 'POST' })
  .validator(ProgressEoiSchema)
  .handler(async ({ data }) => {
    requireFeature('sourcing')
    const user = await requireRole('superadmin', 'admin')
    const db = getDb()
    const existing = await forWrite(data.id, user)
    if (existing.applicationId || !canDecideEoi(existing.status, 'shortlist')) {
      throw stale(existing.status)
    }

    const roundProgramme = await db.query.roundProgrammes.findFirst({
      where: (rp, { eq }) => eq(rp.id, data.roundProgrammeId),
      with: {
        round: { columns: { name: true } },
        programme: { columns: { id: true, clientId: true, name: true } },
      },
    })
    if (!roundProgramme) throw notFoundError()
    assertClientAccess(user, roundProgramme.programme.clientId)
    if (roundProgramme.programme.clientId !== existing.clientId) throw forbidden()

    const applicationId = crypto.randomUUID()
    const values = await sourcedApplicationValues(applicationId, {
      roundProgrammeId: roundProgramme.id,
      organisationName: existing.organisationName,
      contactEmail: data.contactEmail ?? existing.contactEmail,
      charityNumber: existing.charityNumber,
      companyNumber: existing.companyNumber,
      amount: data.amount,
      purpose: data.purpose,
      proposedImpactQuantity: null,
      deliveryArea: data.deliveryArea,
      responses: [
        {
          label: 'How this application came about',
          value:
            'Taken straight to the shortlist from an expression of interest. These are their answers to that form.',
        },
        ...existing.responses,
      ],
      themes: null,
      themesSetBy: null,
      dueDiligence: 'run',
      score: 'queued',
    })

    const partnership = existing.partnershipId
      ? await db.query.partnerships.findFirst({
          where: and(
            eq(partnerships.id, existing.partnershipId),
            eq(partnerships.clientId, existing.clientId),
            isNull(partnerships.applicationId),
          ),
          columns: { id: true },
        })
      : undefined

    const statements = [
      db.insert(applications).values(values),
      db
        .update(eois)
        .set({
          status: 'applied' as const,
          applicationId,
          programmeId: roundProgramme.programme.id,
          decidedAt: new Date(),
          decidedByUserId: user.id,
          decisionNote: `Taken straight to the shortlist for ${roundProgramme.programme.name}, ${roundProgramme.round.name}.`,
          updatedAt: new Date(),
        })
        .where(and(eq(eois.id, existing.id), isNull(eois.applicationId))),
    ] as const
    if (partnership) {
      await db.batch([
        ...statements,
        db
          .update(partnerships)
          .set({ applicationId, status: 'applied', updatedAt: new Date() })
          .where(eq(partnerships.id, partnership.id)),
        db.insert(partnershipEvents).values({
          partnershipId: partnership.id,
          kind: 'shortlisted',
          body: `Taken straight to the shortlist from their expression of interest, for ${roundProgramme.programme.name}, ${roundProgramme.round.name}.`,
          actorUserId: user.id,
        }),
      ])
    } else {
      await db.batch(statements)
    }
    await enqueue({ kind: 'score', applicationId }, () => scoreApplication(applicationId))
    return { applicationId }
  })
