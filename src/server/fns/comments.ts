import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../db'
import {
  applicationComments,
  applicationVotes,
  applications,
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
    if (!app) return { trustees: [] as Array<{ id: string; name: string }>, votes: [] as Array<{ userId: string; vote: 'yes' | 'no'; createdAt: Date }> }

    const clientId = app.roundProgramme.programme.clientId

    const [trustees, votes] = await Promise.all([
      getDb()
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(and(eq(users.role, 'trustee'), eq(users.clientId, clientId))),
      getDb().query.applicationVotes.findMany({
        where: (v, { eq }) => eq(v.applicationId, data.applicationId),
      }),
    ])

    return {
      trustees,
      votes: votes.map((v) => ({ userId: v.userId, vote: v.vote, createdAt: v.createdAt })),
    }
  })

export const castVote = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ applicationId: z.uuid(), vote: z.enum(['yes', 'no']) }))
  .handler(async ({ data }) => {
    const user = await requireRole('trustee')
    await getDb()
      .insert(applicationVotes)
      .values({ applicationId: data.applicationId, userId: user.id, vote: data.vote })
      .onConflictDoUpdate({
        target: [applicationVotes.applicationId, applicationVotes.userId],
        set: { vote: data.vote },
      })
    return { ok: true }
  })
