import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../db'
import {
  applicationComments,
  applicationVotes,
  applications,
  clientProfiles,
  roundProgrammes,
  programmes,
  users,
} from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'

export const listComments = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ applicationId: z.uuid() }))
  .handler(async ({ data }) => {
    await requireAuthUser()
    return getDb().query.applicationComments.findMany({
      where: (c, { eq }) => eq(c.applicationId, data.applicationId),
      with: { user: { columns: { id: true, name: true, role: true } } },
      orderBy: (c, { asc }) => [asc(c.createdAt)],
    })
  })

export const addComment = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ applicationId: z.uuid(), body: z.string().min(1).max(2000) }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'manager', 'trustee', 'finance')
    const [comment] = await getDb()
      .insert(applicationComments)
      .values({ applicationId: data.applicationId, userId: user.id, body: data.body })
      .returning()
    return comment!
  })

export const updateComment = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.uuid(), body: z.string().min(1).max(2000) }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'manager', 'trustee', 'finance')
    const comment = await getDb().query.applicationComments.findFirst({
      where: (c, { eq }) => eq(c.id, data.id),
    })
    if (!comment) throw new Error('Not found')
    // Only the author can edit their own comment.
    if (comment.userId !== user.id) throw new Error('Not authorised')

    const [updated] = await getDb()
      .update(applicationComments)
      .set({ body: data.body, updatedAt: new Date() })
      .where(eq(applicationComments.id, data.id))
      .returning()
    return updated!
  })

export const deleteComment = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'manager', 'trustee', 'finance')
    const comment = await getDb().query.applicationComments.findFirst({
      where: (c, { eq }) => eq(c.id, data.id),
    })
    if (!comment) throw new Error('Not found')
    // The author can delete their own comment; admins can delete any.
    const isAdmin = user.role === 'superadmin' || user.role === 'admin'
    if (comment.userId !== user.id && !isAdmin) throw new Error('Not authorised')

    await getDb().delete(applicationComments).where(eq(applicationComments.id, data.id))
    return { ok: true }
  })

export const listVotes = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ applicationId: z.uuid() }))
  .handler(async ({ data }) => {
    await requireAuthUser()

    const app = await getDb().query.applications.findFirst({
      where: (a, { eq }) => eq(a.id, data.applicationId),
      with: { roundProgramme: { with: { programme: true } } },
    })
    if (!app) return { trustees: [] as Array<{ id: string; name: string }>, votes: [] as Array<{ userId: string; vote: 'yes' | 'no'; createdAt: Date }>, allowAdminVoting: false }

    const clientId = app.roundProgramme.programme.clientId

    const [trustees, votes, profile] = await Promise.all([
      getDb()
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(and(eq(users.role, 'trustee'), eq(users.clientId, clientId))),
      getDb().query.applicationVotes.findMany({
        where: (v, { eq }) => eq(v.applicationId, data.applicationId),
      }),
      getDb().query.clientProfiles.findFirst({
        where: (p, { eq }) => eq(p.clientId, clientId),
      }),
    ])

    return {
      trustees,
      votes: votes.map((v) => ({ userId: v.userId, vote: v.vote, createdAt: v.createdAt })),
      allowAdminVoting: profile?.allowAdminVoting ?? false,
    }
  })

export const castVote = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      applicationId: z.uuid(),
      vote: z.enum(['yes', 'no']),
      // Trustee to record the vote for. Admins only; omitted, a trustee votes as themselves.
      onBehalfOf: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin', 'trustee')
    const isAdmin = user.role === 'superadmin' || user.role === 'admin'

    let targetUserId: string
    if (isAdmin) {
      // Admins don't have a vote of their own — they may only record one on
      // behalf of a trustee, and only when the client has enabled it.
      if (!data.onBehalfOf) throw new Error('Select a trustee to vote on behalf of')

      const app = await getDb().query.applications.findFirst({
        where: (a, { eq }) => eq(a.id, data.applicationId),
        with: { roundProgramme: { with: { programme: true } } },
      })
      if (!app) throw new Error('Not found')
      const clientId = app.roundProgramme.programme.clientId

      // A (non-super) admin may only act within their own client.
      if (user.role === 'admin' && user.clientId !== clientId) throw new Error('Not authorised')

      const profile = await getDb().query.clientProfiles.findFirst({
        where: (p, { eq }) => eq(p.clientId, clientId),
      })
      if (!profile?.allowAdminVoting) throw new Error('Admin voting is not enabled for this organisation')

      // The target must be a trustee of the same client.
      const target = await getDb().query.users.findFirst({
        where: (u, { eq, and: andOp }) =>
          andOp(eq(u.id, data.onBehalfOf!), eq(u.clientId, clientId), eq(u.role, 'trustee')),
      })
      if (!target) throw new Error('Not a trustee of this organisation')
      targetUserId = target.id
    } else {
      // Trustees vote as themselves.
      targetUserId = user.id
    }

    await getDb()
      .insert(applicationVotes)
      .values({ applicationId: data.applicationId, userId: targetUserId, vote: data.vote })
      .onConflictDoUpdate({
        target: [applicationVotes.applicationId, applicationVotes.userId],
        set: { vote: data.vote },
      })
    return { ok: true }
  })
