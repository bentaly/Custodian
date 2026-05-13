import { z } from 'zod'
import { CreateFundSchema, CreateProgrammeSchema, UpdateFundSchema } from '@custodian/validators'
import { protectedProcedure, adminProcedure, router } from '../init.js'

export const fundsRouter = router({
  list: protectedProcedure.query(({ ctx }) => {
    return ctx.db.fund.findMany({
      include: { programmes: true },
      orderBy: { name: 'asc' },
    })
  }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .query(({ ctx, input }) => {
      return ctx.db.fund.findUniqueOrThrow({
        where: { id: input.id },
        include: { programmes: true },
      })
    }),

  create: adminProcedure.input(CreateFundSchema).mutation(({ ctx, input }) => {
    return ctx.db.fund.create({ data: input })
  }),

  update: adminProcedure.input(UpdateFundSchema).mutation(({ ctx, input }) => {
    const { id, ...data } = input
    return ctx.db.fund.update({ where: { id }, data })
  }),

  createProgramme: adminProcedure.input(CreateProgrammeSchema).mutation(({ ctx, input }) => {
    return ctx.db.programme.create({ data: input })
  }),
})
