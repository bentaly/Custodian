import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { clients } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { CreateClientSchema, UpdateClientSchema } from '../../lib/validators/client'

export const listClients = createServerFn({ method: 'GET' }).handler(async () => {
  await requireRole('superadmin')
  return getDb().query.clients.findMany({
    orderBy: (c, { asc }) => [asc(c.name)],
  })
})

export const getClient = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireAuthUser()
    const client = await getDb().query.clients.findFirst({
      where: (c, { eq }) => eq(c.id, data.id),
      with: { rounds: true },
    })
    if (!client) throw new Error('Not found')
    return client
  })

export const createClient = createServerFn({ method: 'POST' })
  .inputValidator(CreateClientSchema)
  .handler(async ({ data }) => {
    await requireRole('superadmin')
    const [client] = await getDb().insert(clients).values(data).returning()
    return client!
  })

export const updateClient = createServerFn({ method: 'POST' })
  .inputValidator(UpdateClientSchema)
  .handler(async ({ data }) => {
    await requireRole('superadmin')
    const { id, ...rest } = data
    const [client] = await getDb()
      .update(clients)
      .set(rest)
      .where(eq(clients.id, id))
      .returning()
    return client!
  })
