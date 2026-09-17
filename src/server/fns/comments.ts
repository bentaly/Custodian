import { badRequest, forbidden, notFoundError } from '../../lib/errors'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { applicationComments, applicationVotes } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { holdsAVote } from '../../lib/voting'
import { recordAudit } from '../audit'
import { assertApplicationAccess } from '../scope'

export const listComments = createServerFn({ method: 'GET' })
  .validator(z.object({ applicationId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser()
    await assertApplicationAccess(user, data.applicationId)
    return getDb().query.applicationComments.findMany({
      where: (c, { eq }) => eq(c.applicationId, data.applicationId),
      with: { user: { columns: { id: true, name: true, role: true } } },
      orderBy: (c, { asc }) => [asc(c.createdAt)],
    })
  })

export const addComment = createServerFn({ method: 'POST' })
  .validator(z.object({ applicationId: z.uuid(), body: z.string().min(1).max(2000) }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'trustee', 'finance')
    await assertApplicationAccess(user, data.applicationId)
    const [comment] = await getDb()
      .insert(applicationComments)
      .values({ applicationId: data.applicationId, userId: user.id, body: data.body })
      .returning()

    await recordAudit({
      actorUserId: user.id,
      action: 'application_commented',
      applicationId: data.applicationId,
    })
    return comment!
  })

export const updateComment = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid(), body: z.string().min(1).max(2000) }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'trustee', 'finance')
    const comment = await getDb().query.applicationComments.findFirst({
      where: (c, { eq }) => eq(c.id, data.id),
    })
    if (!comment) throw notFoundError()
    await assertApplicationAccess(user, comment.applicationId)
    // Only the author can edit their own comment.
    if (comment.userId !== user.id) throw forbidden('You can only change your own comments.')

    const [updated] = await getDb()
      .update(applicationComments)
      .set({ body: data.body, updatedAt: new Date() })
      .where(eq(applicationComments.id, data.id))
      .returning()
    return updated!
  })

export const deleteComment = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'trustee', 'finance')
    const comment = await getDb().query.applicationComments.findFirst({
      where: (c, { eq }) => eq(c.id, data.id),
    })
    if (!comment) throw notFoundError()
    await assertApplicationAccess(user, comment.applicationId)
    // The author can delete their own comment; admins can delete any.
    const isAdmin = user.role === 'superadmin' || user.role === 'admin'
    if (comment.userId !== user.id && !isAdmin)
      throw forbidden('You can only change your own comments.')

    await getDb().delete(applicationComments).where(eq(applicationComments.id, data.id))

    // The comment is gone; the fact that it existed is not. `addComment` logged it
    // being made, and erasing that row to match would let anyone edit the trail by
    // deleting their own remark. The body is kept in the metadata deliberately — a
    // withdrawn concern on a funding decision is exactly what a later reader needs.
    await recordAudit({
      actorUserId: user.id,
      action: 'application_comment_deleted',
      applicationId: comment.applicationId,
      metadata: {
        body: comment.body,
        authorUserId: comment.userId,
        deletedByAdmin: comment.userId !== user.id,
      },
    })
    return { ok: true }
  })

export const castVote = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      applicationId: z.uuid(),
      vote: z.enum(['yes', 'no']),
      // Trustee to record the vote for. Admins only; omitted, the caller votes as
      // themselves, which they may do if they hold a vote of their own.
      onBehalfOf: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'trustee')
    // Applies to every role: you can only vote on applications in your own client.
    await assertApplicationAccess(user, data.applicationId)
    const isAdmin = user.role === 'superadmin' || user.role === 'admin'

    // The two things an admin may be doing here are independent, and both are refused
    // by default. Holding a vote is about this ONE administrator (`users
    // .votes_on_applications`, given on Settings → Team); voting for somebody else is a
    // policy of the whole foundation (`client_profiles.allow_admin_voting`). An admin
    // may easily have one and not the other, which is why neither check stands in for
    // the other and why `onBehalfOf` is what decides which one applies.
    let targetUserId: string
    let proxyForName: string | null = null
    if (isAdmin && data.onBehalfOf) {
      const app = await getDb().query.applications.findFirst({
        where: (a, { eq }) => eq(a.id, data.applicationId),
        with: { roundProgramme: { with: { programme: true } } },
      })
      if (!app) throw notFoundError()
      const clientId = app.roundProgramme.programme.clientId

      const profile = await getDb().query.clientProfiles.findFirst({
        where: (p, { eq }) => eq(p.clientId, clientId),
      })
      if (!profile?.allowAdminVoting)
        throw forbidden('Admin voting is not enabled for this organisation')

      // The target must be a trustee of the same client.
      const target = await getDb().query.users.findFirst({
        where: (u, { eq, and: andOp, isNull }) =>
          andOp(
            eq(u.id, data.onBehalfOf!),
            eq(u.clientId, clientId),
            eq(u.role, 'trustee'),
            isNull(u.archivedAt),
          ),
      })
      if (!target) throw badRequest('Not a trustee of this organisation')
      targetUserId = target.id
      proxyForName = target.name
    } else {
      // Voting as yourself. A trustee always may; an admin may only where the
      // foundation has given them a vote, and this is the boundary that says so — the
      // Shortlist screen hides the buttons from an admin without one, but hidden is not
      // refused.
      if (!holdsAVote(user))
        throw forbidden(
          isAdmin
            ? 'You do not hold a vote on applications. An admin can give you one on Settings → Team.'
            : 'Your role does not vote on applications.',
        )
      targetUserId = user.id
    }

    // `recordedByUserId` is a PROXY, not "an admin touched this": an admin casting their
    // own vote leaves it null, exactly as a trustee does, because there is nobody it was
    // recorded on behalf of. It is set on every branch, never left alone — a trustee
    // voting for themselves after an admin voted for them must clear it, or the row
    // would keep naming an administrator who had nothing to do with the final vote.
    const recordedByUserId = proxyForName === null ? null : user.id
    await getDb()
      .insert(applicationVotes)
      .values({
        applicationId: data.applicationId,
        userId: targetUserId,
        vote: data.vote,
        recordedByUserId,
      })
      .onConflictDoUpdate({
        target: [applicationVotes.applicationId, applicationVotes.userId],
        set: { vote: data.vote, recordedByUserId },
      })

    // Only the proxy case is logged. Anybody voting as themselves is already fully
    // described by the vote row; an administrator entering a vote for somebody ELSE is
    // the event a board would want to find later.
    if (proxyForName !== null) {
      await recordAudit({
        actorUserId: user.id,
        action: 'application_vote_recorded_by_admin',
        applicationId: data.applicationId,
        metadata: { onBehalfOf: proxyForName, trusteeUserId: targetUserId, vote: data.vote },
      })
    }
    return { ok: true }
  })
