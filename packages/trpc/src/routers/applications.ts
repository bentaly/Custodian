import { z } from 'zod'
import { Prisma } from '@custodian/db'
import {
  ApplicationFiltersSchema,
  CreateApplicationSchema,
  UpdateApplicationStatusSchema,
} from '@custodian/validators'
import { protectedProcedure, adminProcedure, router } from '../init.js'

export const applicationsRouter = router({
  list: protectedProcedure.input(ApplicationFiltersSchema).query(async ({ ctx, input }) => {
    const { page, pageSize, ...filters } = input
    const where = {
      ...(filters.status && { status: filters.status }),
      ...(filters.programmeId && { programmeId: filters.programmeId }),
      ...(filters.fundId && { programme: { fundId: filters.fundId } }),
    }

    const [items, total] = await Promise.all([
      ctx.db.application.findMany({
        where,
        include: { organisation: true, programme: { include: { fund: true } } },
        orderBy: { submittedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      ctx.db.application.count({ where }),
    ])

    return { items, total, page, pageSize }
  }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.application.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          organisation: true,
          programme: { include: { fund: true } },
          statusHistory: { include: { changedBy: true }, orderBy: { createdAt: 'desc' } },
        },
      })
    }),

  create: adminProcedure.input(CreateApplicationSchema).mutation(async ({ ctx, input }) => {
    const { rawPayload, ...rest } = input
    return ctx.db.application.create({
      data: {
        ...rest,
        ...(rawPayload !== undefined && { rawPayload: rawPayload as Prisma.InputJsonValue }),
        statusHistory: {
          create: {
            toStatus: 'RECEIVED',
            changedById: ctx.user.id,
          },
        },
      },
    })
  }),

  updateStatus: adminProcedure
    .input(UpdateApplicationStatusSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, status, notes } = input

      const current = await ctx.db.application.findUniqueOrThrow({
        where: { id },
        select: { status: true },
      })

      return ctx.db.application.update({
        where: { id },
        data: {
          status,
          statusHistory: {
            create: {
              fromStatus: current.status,
              toStatus: status,
              notes,
              changedById: ctx.user.id,
            },
          },
        },
      })
    }),
})
