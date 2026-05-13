import { z } from 'zod'
import { CreateOrganisationSchema, UpdateOrganisationSchema } from '@custodian/validators'
import { protectedProcedure, adminProcedure, router } from '../init.js'

export const organisationsRouter = router({
  list: protectedProcedure
    .input(z.object({ search: z.string().optional() }))
    .query(({ ctx, input }) => {
      return ctx.db.organisation.findMany({
        where: input.search
          ? { name: { contains: input.search, mode: 'insensitive' } }
          : undefined,
        orderBy: { name: 'asc' },
        take: 50,
      })
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .query(({ ctx, input }) => {
      return ctx.db.organisation.findUniqueOrThrow({
        where: { id: input.id },
        include: { applications: { orderBy: { submittedAt: 'desc' }, take: 10 } },
      })
    }),

  create: adminProcedure.input(CreateOrganisationSchema).mutation(({ ctx, input }) => {
    return ctx.db.organisation.create({ data: input })
  }),

  update: adminProcedure.input(UpdateOrganisationSchema).mutation(({ ctx, input }) => {
    const { id, ...data } = input
    return ctx.db.organisation.update({ where: { id }, data })
  }),
})
