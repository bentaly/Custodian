import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../db'
import { requireAuthUser, requireAdmin } from '../session'
import {
  ApplicationFiltersSchema,
  CreateApplicationSchema,
  UpdateApplicationStatusSchema,
} from '../../lib/validators/application'

export const listApplications = createServerFn({ method: 'GET' })
  .inputValidator(ApplicationFiltersSchema)
  .handler(async ({ data }) => {
    await requireAuthUser()
    const { page, pageSize, ...filters } = data

    const where = {
      ...(filters.status && { status: filters.status }),
      ...(filters.programmeId && { programmeId: filters.programmeId }),
      ...(filters.fundId && { programme: { fundId: filters.fundId } }),
    }

    const [items, total] = await Promise.all([
      prisma.application.findMany({
        where,
        include: { organisation: true, programme: { include: { fund: true } } },
        orderBy: { submittedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.application.count({ where }),
    ])

    return { items, total, page, pageSize }
  })

export const getApplication = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAuthUser()
    return prisma.application.findUniqueOrThrow({
      where: { id: data.id },
      include: {
        organisation: true,
        programme: { include: { fund: true } },
        statusHistory: { include: { changedBy: true }, orderBy: { createdAt: 'desc' } },
      },
    })
  })

export const createApplication = createServerFn({ method: 'POST' })
  .inputValidator(CreateApplicationSchema)
  .handler(async ({ data }) => {
    const user = await requireAdmin()
    const { rawPayload, ...rest } = data
    return prisma.application.create({
      data: {
        ...rest,
        ...(rawPayload !== undefined && { rawPayload: rawPayload as Prisma.InputJsonValue }),
        statusHistory: {
          create: {
            toStatus: 'RECEIVED',
            changedById: user.id,
          },
        },
      },
    })
  })

export const updateApplicationStatus = createServerFn({ method: 'POST' })
  .inputValidator(UpdateApplicationStatusSchema)
  .handler(async ({ data }) => {
    const user = await requireAdmin()
    const { id, status, notes } = data

    const current = await prisma.application.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    })

    return prisma.application.update({
      where: { id },
      data: {
        status,
        statusHistory: {
          create: {
            fromStatus: current.status,
            toStatus: status,
            notes,
            changedById: user.id,
          },
        },
      },
    })
  })
