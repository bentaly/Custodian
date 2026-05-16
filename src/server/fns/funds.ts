import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { prisma } from '../db'
import { requireAuthUser, requireAdmin } from '../session'
import {
  CreateFundSchema,
  UpdateFundSchema,
  CreateProgrammeSchema,
} from '../../lib/validators/fund'

export const listFunds = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuthUser()
  return prisma.fund.findMany({
    include: { programmes: true },
    orderBy: { name: 'asc' },
  })
})

export const getFund = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAuthUser()
    return prisma.fund.findUniqueOrThrow({
      where: { id: data.id },
      include: { programmes: true },
    })
  })

export const createFund = createServerFn({ method: 'POST' })
  .inputValidator(CreateFundSchema)
  .handler(async ({ data }) => {
    await requireAdmin()
    return prisma.fund.create({ data })
  })

export const updateFund = createServerFn({ method: 'POST' })
  .inputValidator(UpdateFundSchema)
  .handler(async ({ data }) => {
    await requireAdmin()
    const { id, ...rest } = data
    return prisma.fund.update({ where: { id }, data: rest })
  })

export const createProgramme = createServerFn({ method: 'POST' })
  .inputValidator(CreateProgrammeSchema)
  .handler(async ({ data }) => {
    await requireAdmin()
    return prisma.programme.create({ data })
  })
