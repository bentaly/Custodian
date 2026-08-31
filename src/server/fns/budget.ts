import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { forbidden, badRequest } from '../../lib/errors'
import { getDb } from '../db'
import {
  annualBudgetLines,
  annualBudgets,
  bankBalanceReadings,
  clientProfiles,
  programmes,
  roundProgrammes,
  rounds,
} from '../../../drizzle/schema'
import { requireRole } from '../session'
import { recordAudit } from '../audit'
import { balanceAndBudget, ownedProgrammes } from '../finance/budget'
import {
  DEFAULT_FY_END_MONTH,
  financialYear,
  isFyEndMonth,
  shiftFinancialYear,
} from '../../lib/financialYear'
import { todayIso } from '../../lib/schedule'

/**
 * The annual budget and the bank balance: reading, and the two writes.
 *
 * ## Why they are one module and two screens
 *
 * They are read together — the Finance panel answers "can we cover what we promised?"
 * with both — and written apart, because they are different kinds of fact. A budget is a
 * decision the trustees take once a year, so it is set in **Settings**, next to Rounds
 * and Programmes, with the reconciliation against round allocations beside it. A balance
 * is an observation somebody makes off a statement, so it is recorded **on Finance**,
 * where the number is being looked at. Sending someone to Settings to type a figure they
 * are reading off their bank's website would be friction on the one screen that wants it.
 *
 * ## Neither is required, and each works without the other
 *
 * There is deliberately no enable/disable switch. Not every foundation wants this: a
 * family office may draw grant money from the principal's balance sheet on demand and
 * have no standing balance to record, and an endowed foundation's meaningful number is a
 * portfolio held elsewhere — showing a small current-account float against a year of
 * commitments would read as a crisis that is not happening. For all of them the answer
 * is the same: record nothing and the panel does not appear. Absence IS the setting, so
 * there is no flag to get out of step with the data, and the two halves stay independent
 * so a foundation that wants budget tracking and has no useful balance gets exactly that.
 *
 * ## Access
 *
 * Admin and finance, matching `canSeePayments` — a foundation's cash position is at
 * least as sensitive as the payment schedule that gate was written for. As with Finance,
 * the server fn is the boundary; the route guard and the Settings card are courtesies.
 */

/** Same three roles as Finance — see `canSeePayments`. */
const MONEY_ROLES = ['superadmin', 'admin', 'finance'] as const

const MONEY = z
  .number()
  .min(0, 'Amounts cannot be negative')
  // Comfortably past any real foundation, and low enough that a mis-pasted figure is
  // refused rather than stored and drawn as a bar the width of the screen.
  .max(1_000_000_000, 'That is larger than this field allows')
  .refine((n) => Number.isFinite(n), 'Enter a number')

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * The Finance panel's data. Portfolio-wide and independent of the list's filters and
 * paging, which is why it is its own server fn rather than another handful of statements
 * inside `listFinanceGrants` — the panel would otherwise be recomputed on every page turn
 * and every filter change, and it can be refreshed on its own after a balance is
 * recorded.
 *
 * A superadmin with no client of their own gets an empty panel: a bank balance is one
 * foundation's, and there is no sensible cross-tenant version of this screen (the same
 * reason `digestWindow` requires a `clientId`).
 */
export const getBalanceAndBudget = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireRole(...MONEY_ROLES)
  if (!user.clientId) return null
  return balanceAndBudget(getDb(), user.clientId)
})

/**
 * Whether Finance offers its second screen — all the payments list needs to draw the tabs.
 *
 * Its own tiny fn rather than a field on `listFinanceGrants`: that one is built from a
 * round-programme scope and knows nothing of `clientId`, and this is a single-row lookup
 * on a unique index that runs in parallel with it. It is deliberately NOT on `getMe`,
 * which is read on every authenticated call — the same reason avatars were moved off the
 * `users` row.
 */
export const getFinanceNav = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireRole(...MONEY_ROLES)
  if (!user.clientId) return { showBalanceAndBudget: false }
  const profile = await getDb().query.clientProfiles.findFirst({
    where: (p, { eq: e }) => e(p.clientId, user.clientId!),
    columns: { showBalanceAndBudget: true },
  })
  return { showBalanceAndBudget: profile?.showBalanceAndBudget ?? true }
})

/**
 * Show or hide the Balance & budget screen.
 *
 * Writes nothing but the flag. Hiding must never be a way to lose figures somebody spent
 * an afternoon entering — that was the first cut's mistake, where the only way back to
 * "we don't work like this" was clearing every line.
 */
export const setBalanceAndBudgetVisible = createServerFn({ method: 'POST' })
  .validator(z.object({ visible: z.boolean() }))
  .handler(async ({ data }) => {
    const user = await requireRole(...MONEY_ROLES)
    if (!user.clientId) throw forbidden('No organisation is associated with your account.')
    await getDb()
      .insert(clientProfiles)
      .values({ clientId: user.clientId, showBalanceAndBudget: data.visible })
      .onConflictDoUpdate({
        target: clientProfiles.clientId,
        set: { showBalanceAndBudget: data.visible, updatedAt: new Date() },
      })
    return { ok: true as const, visible: data.visible }
  })

/**
 * Everything the Settings → Annual budget screen draws.
 *
 * Three things beyond the budget itself: the programmes to offer as lines, the year-end
 * setting the year is derived from, and what this year's ROUNDS have allocated — which
 * is the reconciliation that cannot exist without an annual figure to check against, and
 * doubles as the prefill for a foundation whose rounds already are their year's plan.
 */
export const getAnnualBudgetSettings = createServerFn({ method: 'GET' })
  .validator(
    z
      .object({
        /** 0 = this financial year, -1 = last, +1 = next. Bounded so the picker cannot wander. */
        yearOffset: z.number().int().min(-5).max(1).optional(),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    const user = await requireRole(...MONEY_ROLES)
    if (!user.clientId) throw forbidden('No organisation is associated with your account.')
    const db = getDb()
    const clientId = user.clientId

    const profile = await db.query.clientProfiles.findFirst({
      where: (p, { eq: e }) => e(p.clientId, clientId),
      columns: { financialYearEndMonth: true, showBalanceAndBudget: true },
    })
    const endMonth = profile?.financialYearEndMonth ?? DEFAULT_FY_END_MONTH
    const offset = data?.yearOffset ?? 0
    const fy = offset === 0 ? financialYear(endMonth) : shiftFinancialYear(endMonth, offset)

    const [budgetRows, programmeRows, allocationRows] = await db.batch([
      db
        .select({
          id: annualBudgets.id,
          label: annualBudgets.label,
          lineId: annualBudgetLines.id,
          programmeId: annualBudgetLines.programmeId,
          lineLabel: annualBudgetLines.label,
          amount: annualBudgetLines.amount,
        })
        .from(annualBudgets)
        .leftJoin(annualBudgetLines, eq(annualBudgetLines.budgetId, annualBudgets.id))
        .where(
          and(eq(annualBudgets.clientId, clientId), eq(annualBudgets.financialYearStart, fy.start)),
        ),

      db
        .select({ id: programmes.id, name: programmes.name, colour: programmes.colour })
        .from(programmes)
        .where(and(eq(programmes.clientId, clientId), isNull(programmes.archivedAt)))
        .orderBy(programmes.name),

      // What the ROUNDS overlapping this year have allocated, per programme.
      //
      // "Overlapping" rather than "closing in": a round that opened in February and runs
      // to June is spending both years' money, and a reconciliation that ignored it would
      // under-report every time. An undated round matches every year — deliberate, since a
      // foundation that has not dated its rounds still wants to see their allocations, and
      // this figure is advice on a settings screen rather than a gate on anything.
      db
        .select({
          programmeId: roundProgrammes.programmeId,
          allocated: sql<string>`coalesce(sum(${roundProgrammes.budget}), 0)`,
        })
        .from(roundProgrammes)
        .innerJoin(rounds, eq(rounds.id, roundProgrammes.roundId))
        .where(
          and(
            eq(rounds.clientId, clientId),
            isNull(rounds.archivedAt),
            sql`(${rounds.openedAt} is null or ${rounds.openedAt} < (${fy.end}::date + 1))`,
            sql`(${rounds.closedAt} is null or ${rounds.closedAt} >= ${fy.start}::date)`,
          ),
        )
        .groupBy(roundProgrammes.programmeId),
    ])

    const existing = budgetRows[0]
    return {
      financialYear: fy,
      financialYearEndMonth: endMonth,
      showBalanceAndBudget: profile?.showBalanceAndBudget ?? true,
      yearOffset: offset,
      exists: budgetRows.length > 0,
      label: existing?.label ?? fy.label,
      lines: budgetRows
        .filter((r) => r.lineId)
        .map((r) => ({
          programmeId: r.programmeId,
          label: r.lineLabel,
          amount: parseFloat(r.amount ?? '0'),
        })),
      programmes: programmeRows,
      roundAllocations: allocationRows.map((r) => ({
        programmeId: r.programmeId,
        allocated: parseFloat(r.allocated),
      })),
    }
  })

/**
 * Save one financial year's budget: the header row and the whole set of lines.
 *
 * Lines are a **replacement, not a patch** — the same rule a round's programme array
 * follows (`saveRound`). The screen edits the whole list, so sending the whole list is
 * what it means; a patch protocol would leave no way to express "this programme no
 * longer has an allocation".
 *
 * The delete and the re-insert are in one `db.batch()` so a foundation's budget is never
 * momentarily empty — neon-http has no interactive transactions, and a failure between
 * two separate statements would leave a saved budget with no lines in it.
 */
export const saveAnnualBudget = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      /** Inclusive `yyyy-mm-dd` bounds, as `getAnnualBudgetSettings` returned them. */
      financialYearStart: z.string().regex(ISO_DAY),
      financialYearEnd: z.string().regex(ISO_DAY),
      label: z.string().min(1).max(40),
      lines: z
        .array(
          z.object({
            /** NULL for a non-grant line (core costs), which carries its own label. */
            programmeId: z.uuid().nullable(),
            label: z.string().max(80).nullable(),
            amount: MONEY,
          }),
        )
        .max(100),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireRole(...MONEY_ROLES)
    if (!user.clientId) throw forbidden('No organisation is associated with your account.')
    if (data.financialYearEnd < data.financialYearStart) {
      throw badRequest('The financial year ends before it starts.')
    }
    const db = getDb()
    const clientId = user.clientId

    // A programme line must name a programme of THIS tenant. The ids come from a select
    // the same call populated, but they arrive over the wire like anything else, and a
    // budget line pointing at another foundation's programme would put that programme's
    // name on this foundation's screen.
    const programmeIds = data.lines.map((l) => l.programmeId).filter((id): id is string => !!id)
    if (new Set(programmeIds).size !== programmeIds.length) {
      throw badRequest('A programme can only appear once in a budget.')
    }
    if (programmeIds.length > 0) {
      const owned = await ownedProgrammes(db, clientId, programmeIds)
      if (owned.length !== programmeIds.length) {
        throw badRequest('One of those programmes does not belong to your organisation.')
      }
    }

    const previous = await db
      .select({
        id: annualBudgets.id,
        total: sql<string>`coalesce(sum(${annualBudgetLines.amount}), 0)`,
      })
      .from(annualBudgets)
      .leftJoin(annualBudgetLines, eq(annualBudgetLines.budgetId, annualBudgets.id))
      .where(
        and(
          eq(annualBudgets.clientId, clientId),
          eq(annualBudgets.financialYearStart, data.financialYearStart),
        ),
      )
      .groupBy(annualBudgets.id)

    const lines = data.lines
      // A zero line and no line say the same thing, and keeping zeroes would draw empty
      // meters for programmes the foundation deliberately funded nothing in this year.
      .filter((l) => l.amount > 0)

    // ── Saving nothing REMOVES the budget ────────────────────────────────────
    //
    // Clearing every amount is how a foundation says "we do not budget this way", and it
    // has to be a reachable state: without this the header row survives its own lines,
    // `hasBudget` stays true on the read side, and the Finance panel draws "£0 of £0"
    // with no meters — a broken screen nobody could get out of. Deleting cascades to the
    // lines, so there is nothing left to go stale.
    if (lines.length === 0) {
      await db
        .delete(annualBudgets)
        .where(
          and(
            eq(annualBudgets.clientId, clientId),
            eq(annualBudgets.financialYearStart, data.financialYearStart),
          ),
        )
      if (previous.length > 0) {
        await recordAudit({
          clientId,
          actorUserId: user.id,
          action: 'annual_budget_set',
          metadata: {
            financialYear: data.label,
            total: { from: parseFloat(previous[0]!.total).toFixed(2), to: null },
          },
        })
      }
      return { ok: true as const, total: 0, removed: true as const }
    }

    const [budget] = await db
      .insert(annualBudgets)
      .values({
        clientId,
        financialYearStart: data.financialYearStart,
        financialYearEnd: data.financialYearEnd,
        label: data.label,
        updatedByUserId: user.id,
      })
      .onConflictDoUpdate({
        target: [annualBudgets.clientId, annualBudgets.financialYearStart],
        set: {
          financialYearEnd: data.financialYearEnd,
          label: data.label,
          updatedByUserId: user.id,
          updatedAt: new Date(),
        },
      })
      .returning({ id: annualBudgets.id })

    const budgetId = budget!.id
    const rows = lines.map((l) => ({
      budgetId,
      programmeId: l.programmeId,
      label: l.programmeId ? null : l.label?.trim() || 'Core costs',
      amount: l.amount.toFixed(2),
    }))

    // Both writes in ONE batch, so a foundation's budget is never momentarily empty:
    // neon-http has no interactive transactions, and a failure between two separate
    // statements would leave a saved budget with every line deleted and none replaced.
    await db.batch([
      db.delete(annualBudgetLines).where(eq(annualBudgetLines.budgetId, budgetId)),
      db.insert(annualBudgetLines).values(rows),
    ])

    const total = rows.reduce((s, r) => s + parseFloat(r.amount), 0)
    await recordAudit({
      clientId,
      actorUserId: user.id,
      action: 'annual_budget_set',
      metadata: {
        financialYear: data.label,
        total: {
          from: previous.length > 0 ? parseFloat(previous[0]!.total).toFixed(2) : null,
          to: total.toFixed(2),
        },
      },
    })

    return { ok: true as const, total, removed: false as const }
  })

/**
 * The financial year end — a month, 1–12.
 *
 * Its own write rather than a field on the budget form, because it is organisation-wide
 * config that every future year's budget is derived from, while a budget belongs to one
 * year. Changing it does NOT re-date budgets already saved: those store their own
 * resolved bounds, so last year's figures keep the year they were actually set for
 * instead of silently re-labelling themselves under the new setting.
 */
export const saveFinancialYearEndMonth = createServerFn({ method: 'POST' })
  .validator(z.object({ month: z.number().int().min(1).max(12) }))
  .handler(async ({ data }) => {
    const user = await requireRole(...MONEY_ROLES)
    if (!user.clientId) throw forbidden('No organisation is associated with your account.')
    if (!isFyEndMonth(data.month)) throw badRequest('Pick a month.')
    await getDb()
      .insert(clientProfiles)
      .values({ clientId: user.clientId, financialYearEndMonth: data.month })
      .onConflictDoUpdate({
        target: clientProfiles.clientId,
        set: { financialYearEndMonth: data.month, updatedAt: new Date() },
      })
    return { ok: true as const, month: data.month }
  })

/**
 * Record a reading of the grant-making bank balance.
 *
 * An INSERT, never an update. The figure on screen is one a board may act on, so who
 * said it and when it was true are part of the number rather than metadata about it —
 * and a correction is a new reading that supersedes, not an overwrite that erases what
 * the previous decision was taken against.
 *
 * `asAtDate` is the date the balance was TRUE. Somebody entering Monday's closing figure
 * on Thursday must be able to say so, or the staleness warning on the panel is wrong in
 * both directions. Future dates are refused: a balance cannot be observed in advance.
 */
export const recordBankBalance = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      amount: MONEY,
      asAtDate: z.string().regex(ISO_DAY),
      note: z.string().max(200).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireRole(...MONEY_ROLES)
    if (!user.clientId) throw forbidden('No organisation is associated with your account.')
    if (data.asAtDate > todayIso()) throw badRequest('A balance cannot be dated in the future.')

    await getDb()
      .insert(bankBalanceReadings)
      .values({
        clientId: user.clientId,
        amount: data.amount.toFixed(2),
        asAtDate: data.asAtDate,
        note: data.note?.trim() || null,
        recordedByUserId: user.id,
      })

    await recordAudit({
      clientId: user.clientId,
      actorUserId: user.id,
      action: 'bank_balance_recorded',
      metadata: { amount: data.amount.toFixed(2), asAtDate: data.asAtDate },
    })

    return { ok: true as const }
  })
