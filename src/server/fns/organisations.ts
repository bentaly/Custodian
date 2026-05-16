import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { prisma } from '../db'
import { requireAuthUser, requireAdmin } from '../session'
import {
  CreateOrganisationSchema,
  UpdateOrganisationSchema,
} from '../../lib/validators/organisation'

export const listOrganisations = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ search: z.string().optional() }))
  .handler(async ({ data }) => {
    await requireAuthUser()
    return prisma.organisation.findMany({
      where: data.search
        ? { name: { contains: data.search, mode: 'insensitive' } }
        : undefined,
      orderBy: { name: 'asc' },
      take: 50,
    })
  })

export const getOrganisation = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAuthUser()
    return prisma.organisation.findUniqueOrThrow({
      where: { id: data.id },
      include: { applications: { orderBy: { submittedAt: 'desc' }, take: 10 } },
    })
  })

export const createOrganisation = createServerFn({ method: 'POST' })
  .inputValidator(CreateOrganisationSchema)
  .handler(async ({ data }) => {
    await requireAdmin()
    return prisma.organisation.create({ data })
  })

export const updateOrganisation = createServerFn({ method: 'POST' })
  .inputValidator(UpdateOrganisationSchema)
  .handler(async ({ data }) => {
    await requireAdmin()
    const { id, ...rest } = data
    return prisma.organisation.update({ where: { id }, data: rest })
  })
