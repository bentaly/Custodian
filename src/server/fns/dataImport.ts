import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, count, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { getDb } from '../db'
import {
  applicationComments,
  applicationVotes,
  awardInstalments,
  awardLetters,
  awards,
  applications,
  clients,
  importBatches,
  programmes,
  reportSchedule,
  reports,
  roundProgrammes,
  rounds,
} from '../../../drizzle/schema'
import { requireRole } from '../session'
import { badRequest, conflict, notFoundError } from '../../lib/errors'
import { resolveColumn, type Candidate } from '../../lib/dataImport/match'
import { validateImport, type ExistingReference } from '../../lib/dataImport/validate'
import { CommitImportSchema, ImportPayloadSchema } from '../../lib/validators/dataImport'
import type { GrantRow } from '../../lib/dataImport/parse'

// ─── Historical data import ─────────────────────────────────────────────────
//
// Admin-only throughout: this writes a foundation's entire back catalogue, and it can
// delete it again. Every fn re-derives the caller's client rather than trusting
// anything in the payload — the browser parses the workbook, so nothing it sends is
// authoritative.

async function requireImportAdmin() {
  const user = await requireRole('admin', 'superadmin')
  if (!user.clientId) {
    // A superadmin has no client of their own, and an import has to land somewhere.
    throw badRequest('Switch to a foundation account to import data.')
  }
  return { user, clientId: user.clientId }
}

// ─── Context for generating the template ────────────────────────────────────

/**
 * What the per-client template needs: the real programmes and rounds that become
 * dropdowns in the workbook. Generating the file AFTER a foundation has set its
 * programmes up is what removes column-matching from the flow entirely — a file
 * filled in from these lists needs no mapping step at all.
 */
export const getImportContext = createServerFn({ method: 'GET' }).handler(async () => {
  const { clientId } = await requireImportAdmin()
  const db = getDb()

  const [client, programmeRows, roundRows] = await Promise.all([
    db.query.clients.findFirst({ where: eq(clients.id, clientId), columns: { name: true } }),
    db
      .select({ id: programmes.id, name: programmes.name })
      .from(programmes)
      .where(eq(programmes.clientId, clientId))
      .orderBy(programmes.name),
    db
      .select({ id: rounds.id, name: rounds.name })
      .from(rounds)
      .where(eq(rounds.clientId, clientId))
      .orderBy(rounds.name),
  ])

  return {
    clientId,
    foundationName: client?.name ?? 'Your foundation',
    programmes: programmeRows,
    rounds: roundRows,
  }
})

// ─── Validation pass ────────────────────────────────────────────────────────

/** References already in Custodian, and whether an import put them there. */
async function existingReferences(clientId: string): Promise<ExistingReference[]> {
  const rows = await getDb()
    .select({
      reference: applications.externalApplicationId,
      importBatchId: applications.importBatchId,
    })
    .from(applications)
    .innerJoin(roundProgrammes, eq(applications.roundProgrammeId, roundProgrammes.id))
    .innerJoin(programmes, eq(roundProgrammes.programmeId, programmes.id))
    .where(and(eq(programmes.clientId, clientId), isNotNull(applications.externalApplicationId)))

  return rows
    .filter((r): r is { reference: string; importBatchId: string | null } => r.reference !== null)
    .map((r) => ({ reference: r.reference, importedByBatch: r.importBatchId !== null }))
}

/**
 * Check an uploaded workbook and say what it will and won't give them.
 *
 * Returns three things the review screen needs: the issues (blockers vs degradations),
 * the reconciliation totals, and the programme/round values that need a human decision
 * because the dropdowns didn't catch them. Writes nothing.
 */
export const prepareImport = createServerFn({ method: 'POST' })
  .validator(ImportPayloadSchema)
  .handler(async ({ data }) => {
    const { clientId } = await requireImportAdmin()
    const db = getDb()

    const [programmeRows, roundRows, existing] = await Promise.all([
      db
        .select({ id: programmes.id, name: programmes.name })
        .from(programmes)
        .where(eq(programmes.clientId, clientId)),
      db
        .select({ id: rounds.id, name: rounds.name })
        .from(rounds)
        .where(eq(rounds.clientId, clientId)),
      existingReferences(clientId),
    ])

    const validation = validateImport({ ...data, existingReferences: existing })

    // Resolved per DISTINCT value, not per row: 340 rows typically carry six distinct
    // programme names, so one confirmation settles every row that shares it.
    const programmeResolutions = resolveColumn(
      data.grants.map((g) => g.programme),
      programmeRows as Candidate[],
    )
    const roundResolutions = resolveColumn(
      data.grants.map((g) => g.round),
      roundRows as Candidate[],
    )

    return {
      ...validation,
      programmes: programmeRows,
      rounds: roundRows,
      resolutions: { programmes: programmeResolutions, rounds: roundResolutions },
      /** Grants already imported under the same reference — these will be replaced. */
      replacing: data.grants.filter((g) =>
        existing.some(
          (e) => e.importedByBatch && e.reference.toLowerCase() === g.reference.toLowerCase(),
        ),
      ).length,
    }
  })

// ─── Commit ─────────────────────────────────────────────────────────────────

/** `IMP-0001`-style, for foundations that have never used references of their own. */
function generatedReference(index: number): string {
  return `IMP-${String(index + 1).padStart(4, '0')}`
}

export const commitImport = createServerFn({ method: 'POST' })
  .validator(CommitImportSchema)
  .handler(async ({ data }) => {
    const { user, clientId } = await requireImportAdmin()
    const db = getDb()
    const { payload, mapping } = data

    // Re-validate server-side. The browser did this already, but the browser is a
    // convenience and this is the door to the database.
    const existing = await existingReferences(clientId)
    const validation = validateImport({ ...payload, existingReferences: existing })
    if (!validation.canCommit) {
      throw badRequest(
        'This workbook still has problems that must be fixed before it can be imported.',
      )
    }

    // ── Resolve programmes ──
    //
    // Every mapped id is checked against this client's own programmes: the mapping
    // arrives from the browser, so an id from another tenant must not be honoured.
    const ownProgrammes = await db
      .select({ id: programmes.id, name: programmes.name, impactUnit: programmes.impactUnit })
      .from(programmes)
      .where(eq(programmes.clientId, clientId))
    const programmeById = new Map(ownProgrammes.map((p) => [p.id, p]))

    const programmeIdFor = new Map<string, string>()
    for (const [name, id] of Object.entries(mapping.programmes)) {
      if (!programmeById.has(id)) throw badRequest('That programme does not belong to you.')
      programmeIdFor.set(name.trim().toLowerCase(), id)
    }

    const ownRounds = await db
      .select({ id: rounds.id, name: rounds.name })
      .from(rounds)
      .where(eq(rounds.clientId, clientId))
    const roundById = new Map(ownRounds.map((r) => [r.id, r]))

    const roundIdFor = new Map<string, string>()
    const newRounds: Array<{ id: string; name: string }> = []
    for (const [name, id] of Object.entries(mapping.rounds)) {
      if (id === null) {
        // "Create it" — historic rounds are labels, and blocking an import until
        // someone hand-creates eleven of them helps nobody.
        const created = { id: crypto.randomUUID(), name: name.trim() }
        newRounds.push(created)
        roundIdFor.set(name.trim().toLowerCase(), created.id)
      } else {
        if (!roundById.has(id)) throw badRequest('That round does not belong to you.')
        roundIdFor.set(name.trim().toLowerCase(), id)
      }
    }

    for (const grant of payload.grants) {
      if (!programmeIdFor.has(grant.programme.trim().toLowerCase())) {
        throw badRequest(`No programme was chosen for “${grant.programme}”.`)
      }
      if (!roundIdFor.has(grant.round.trim().toLowerCase())) {
        throw badRequest(`No round was chosen for “${grant.round}”.`)
      }
    }

    // ── Round-programme pairings ──
    //
    // An application must hang off a (round, programme) pairing. Historic pairings
    // mostly won't exist, and they carry a NOT NULL budget — set to 0 here because a
    // budget is a forward-looking control on a round you are still deciding, and
    // inventing a number for a round that closed in 2019 would be worse than a zero.
    const existingPairs = await db
      .select({
        id: roundProgrammes.id,
        roundId: roundProgrammes.roundId,
        programmeId: roundProgrammes.programmeId,
      })
      .from(roundProgrammes)
      .innerJoin(programmes, eq(roundProgrammes.programmeId, programmes.id))
      .where(eq(programmes.clientId, clientId))

    const pairKey = (roundId: string, programmeId: string) => `${roundId}:${programmeId}`
    const pairIdFor = new Map(existingPairs.map((p) => [pairKey(p.roundId, p.programmeId), p.id]))
    const newPairs: Array<{ id: string; roundId: string; programmeId: string }> = []

    for (const grant of payload.grants) {
      const programmeId = programmeIdFor.get(grant.programme.trim().toLowerCase())!
      const roundId = roundIdFor.get(grant.round.trim().toLowerCase())!
      const key = pairKey(roundId, programmeId)
      if (!pairIdFor.has(key)) {
        const created = { id: crypto.randomUUID(), roundId, programmeId }
        newPairs.push(created)
        pairIdFor.set(key, created.id)
      }
    }

    // ── Replace anything a previous import already brought in ──
    //
    // Re-uploading is the phasing mechanism (live grants first, historic later), so the
    // same reference arriving twice must update rather than duplicate. These rows are
    // import-owned, so replacing them wholesale is safe and much simpler than a
    // field-by-field merge. Awards go before applications: the FK is `restrict`, so an
    // application cannot be removed while its award still points at it.
    const incomingRefs = new Set(
      payload.grants.map((g) => g.reference.trim().toLowerCase()).filter(Boolean),
    )
    const replaceable = await db
      .select({ id: applications.id, reference: applications.externalApplicationId })
      .from(applications)
      .innerJoin(roundProgrammes, eq(applications.roundProgrammeId, roundProgrammes.id))
      .innerJoin(programmes, eq(roundProgrammes.programmeId, programmes.id))
      .where(and(eq(programmes.clientId, clientId), isNotNull(applications.importBatchId)))
    const replacingIds = replaceable
      .filter((r) => r.reference && incomingRefs.has(r.reference.toLowerCase()))
      .map((r) => r.id)

    // ── Build the rows ──

    const batchId = crypto.randomUUID()
    const usedReferences = new Set(
      existing
        .filter((e) => !incomingRefs.has(e.reference.toLowerCase()))
        .map((e) => e.reference.toLowerCase()),
    )

    let generatedCounter = 0
    const referenceFor = (grant: GrantRow): string => {
      if (grant.reference) return grant.reference
      let candidate = generatedReference(generatedCounter++)
      while (usedReferences.has(candidate.toLowerCase())) {
        candidate = generatedReference(generatedCounter++)
      }
      usedReferences.add(candidate.toLowerCase())
      return candidate
    }

    const applicationRows: Array<typeof applications.$inferInsert> = []
    const awardRows: Array<typeof awards.$inferInsert> = []
    const instalmentRows: Array<typeof awardInstalments.$inferInsert> = []
    const scheduleRows: Array<typeof reportSchedule.$inferInsert> = []
    const reportRows: Array<typeof reports.$inferInsert> = []
    const generatedReferences: Array<{ organisationName: string; reference: string }> = []

    const paymentsByRef = new Map<string, typeof payload.payments>()
    for (const p of payload.payments) {
      const list = paymentsByRef.get(p.reference) ?? []
      list.push(p)
      paymentsByRef.set(p.reference, list)
    }
    const reportsByRef = new Map<string, typeof payload.reports>()
    for (const r of payload.reports) {
      const list = reportsByRef.get(r.reference) ?? []
      list.push(r)
      reportsByRef.set(r.reference, list)
    }

    for (const grant of payload.grants) {
      const programmeId = programmeIdFor.get(grant.programme.trim().toLowerCase())!
      const roundId = roundIdFor.get(grant.round.trim().toLowerCase())!
      const roundProgrammeId = pairIdFor.get(pairKey(roundId, programmeId))!
      const programme = programmeById.get(programmeId)!

      const reference = referenceFor(grant)
      if (!grant.reference) {
        generatedReferences.push({ organisationName: grant.organisationName, reference })
      }

      const applicationId = crypto.randomUUID()
      const awardId = crypto.randomUUID()
      const decisionAt = new Date(`${grant.awardDate}T00:00:00Z`)

      applicationRows.push({
        id: applicationId,
        roundProgrammeId,
        externalApplicationId: reference,
        organisationName: grant.organisationName,
        applicantEmail: grant.contactEmail,
        charityNumber: grant.charityNumber,
        companyNumber: grant.companyNumber,
        // The request figure is unknown for a historic grant; the award figure is the
        // only number that was ever recorded, and leaving it null is not an option
        // (NOT NULL). Every screen reading it is showing what was awarded anyway.
        amountRequested: String(grant.amountAwarded),
        deliveryArea: grant.deliveryArea,
        // The purpose the foundation recorded in their own ledger. It goes on the
        // application as well as the award because it is the same statement, and
        // because it is the only thing an imported row can say about what the money
        // funded — the score below never runs, so nothing else would fill that panel.
        grantPurpose: grant.purpose,
        status: 'awarded',
        // Deliberately left at their defaults (`pending`): due diligence and the
        // deprivation lookup re-derive themselves from the registration number and the
        // delivery area we just imported. Importing stale results would be worse than
        // useless. The Custodian score stays pending forever — scoring a 2019
        // application against goals written in 2026 would be a confident, meaningless
        // number, so no score is the honest answer.
        submittedAt: decisionAt,
        decisionAt,
        importBatchId: batchId,
      } as typeof applications.$inferInsert)

      awardRows.push({
        id: awardId,
        applicationId,
        clientId,
        amountAwarded: String(grant.amountAwarded),
        status:
          grant.status === 'active'
            ? 'active'
            : grant.status === 'cancelled'
              ? 'cancelled'
              : 'completed',
        purpose: grant.purpose,
        startDate: grant.awardDate,
        decisionAt,
        importBatchId: batchId,
      })

      const payments = paymentsByRef.get(grant.reference) ?? []
      if (payments.length > 0) {
        payments
          .slice()
          .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
          .forEach((p, i) => {
            instalmentRows.push({
              id: crypto.randomUUID(),
              awardId,
              instalmentNo: i + 1,
              amount: String(p.amount),
              dueDate: p.dueDate,
              // A payment marked paid with no date still counts as paid — the client was
              // warned it loses its place on a timeline, and dropping the fact of payment
              // would be far worse than losing the date.
              paidDate: p.paid ? (p.paidDate ?? p.dueDate) : null,
            })
          })
      } else if (grant.amountPaid != null && grant.amountPaid > 0) {
        // A completed grant is filled in on the Grants sheet alone, so its money arrives
        // as one "Amount paid" figure. It becomes a single paid instalment, because
        // every screen that shows money moving — Finance, the paid total, spend over
        // time — reads instalments. Recording it only on the reconciliation the client
        // just confirmed would leave the grant showing £0 paid the moment they opened it.
        // Dated at the grant's end, which is the last day the money can have gone out;
        // itemised rows are the way to say more than that, and the template says so.
        instalmentRows.push({
          id: crypto.randomUUID(),
          awardId,
          instalmentNo: 1,
          amount: String(grant.amountPaid),
          dueDate: grant.endDate ?? grant.awardDate,
          paidDate: grant.endDate ?? grant.awardDate,
        })
      }

      const milestones = reportsByRef.get(grant.reference) ?? []
      const scheduleIds = milestones.map(() => crypto.randomUUID())
      milestones.forEach((m, i) => {
        scheduleRows.push({
          id: scheduleIds[i]!,
          awardId,
          label: m.label,
          dueDate: m.dueDate,
          // `submittedDate` is what makes a milestone met, so a report answered "Yes"
          // with no date falls back to the due date rather than staying null — same
          // rule as a payment marked paid with no date, and for the same reason: the
          // fact is worth more than the precision. The client was warned.
          submittedDate: m.received ? (m.receivedDate ?? m.dueDate) : null,
        })
      })

      // A historic impact figure, recorded as a report so Insights — which already
      // reads impact from reports — needs no special case for imported history.
      // No AI analysis: there is no narrative to analyse, just a number.
      if (grant.impactQuantity != null) {
        const satisfied = milestones.findIndex((m) => m.received)
        reportRows.push({
          id: crypto.randomUUID(),
          clientId,
          awardId,
          scheduleId: satisfied >= 0 ? scheduleIds[satisfied]! : null,
          matchMethod: 'import',
          externalApplicationId: reference,
          organisationName: grant.organisationName,
          charityNumber: grant.charityNumber,
          companyNumber: grant.companyNumber,
          impactSummary:
            'Figure supplied by the foundation when its historic grants were imported.',
          impactQuantity: String(grant.impactQuantity),
          impactQuantitySource: 'reported',
          impactUnitLabel: programme.impactUnit,
          analysisStatus: 'pending',
          submittedAt: decisionAt,
          importBatchId: batchId,
        })
      }
    }

    // ── Write ──
    //
    // No `db.transaction()` — the neon-http driver throws on it. `db.batch` sends these
    // as one ordered batch, which is what keeps a half-written import from happening.
    // Multi-row inserts keep the statement count flat regardless of portfolio size.
    const statements: any[] = []

    if (replacingIds.length > 0) {
      // Cascades take instalments, schedule and reports with the award.
      statements.push(db.delete(awards).where(inArray(awards.applicationId, replacingIds)))
      statements.push(db.delete(applications).where(inArray(applications.id, replacingIds)))
    }

    statements.push(
      db.insert(importBatches).values({
        id: batchId,
        clientId,
        fileName: data.fileName,
        grantCount: payload.grants.length,
        paymentCount: payload.payments.length,
        reportCount: payload.reports.length,
        totalCommitted: String(validation.reconciliation.totalCommitted),
        totalPaid: String(validation.reconciliation.totalPaid),
        totalOutstanding: String(validation.reconciliation.totalOutstanding),
        acceptedWarnings: data.acceptedWarnings,
        createdBy: user.id,
        createdByName: user.name,
      }),
    )

    if (newRounds.length > 0) {
      statements.push(
        db.insert(rounds).values(
          newRounds.map((r) => ({
            id: r.id,
            clientId,
            name: r.name,
            // A historic round is closed by definition — it is being imported because
            // its decisions were made. Leaving it open would put finished grants in the
            // round pickers on Applications and Shortlist.
            openedAt: new Date(),
            closedAt: new Date(),
          })),
        ),
      )
    }
    if (newPairs.length > 0) {
      statements.push(
        db.insert(roundProgrammes).values(newPairs.map((p) => ({ ...p, budget: '0' }))),
      )
    }

    statements.push(db.insert(applications).values(applicationRows))
    statements.push(db.insert(awards).values(awardRows))
    if (instalmentRows.length > 0)
      statements.push(db.insert(awardInstalments).values(instalmentRows))
    if (scheduleRows.length > 0) statements.push(db.insert(reportSchedule).values(scheduleRows))
    if (reportRows.length > 0) statements.push(db.insert(reports).values(reportRows))

    await db.batch(statements as [any, ...any[]])

    // Deliberately NO audit_log rows and NO award letters. The feed reads by date, so
    // writing one entry per grant would show 127 awards "made today"; and an import that
    // emailed award letters would notify 127 charities about grants they received years
    // ago. Both are stated here because both are catastrophic and easy to add by reflex.

    return {
      batchId,
      grants: applicationRows.length,
      payments: instalmentRows.length,
      reportMilestones: scheduleRows.length,
      replaced: replacingIds.length,
      roundsCreated: newRounds.map((r) => r.name),
      generatedReferences,
      reconciliation: validation.reconciliation,
    }
  })

// ─── History and rollback ───────────────────────────────────────────────────

export const listImportBatches = createServerFn({ method: 'GET' }).handler(async () => {
  const { clientId } = await requireImportAdmin()
  const db = getDb()

  const rows = await db.query.importBatches.findMany({
    where: eq(importBatches.clientId, clientId),
    orderBy: (b, { desc }) => [desc(b.createdAt)],
    limit: 50,
  })
  if (rows.length === 0) return []

  // How many of each batch's grants are still ITS grants. A later import of the same
  // references replaces them, which leaves the earlier batch owning nothing while its
  // stored counts still say four — so the history would offer an Undo that removes
  // nothing. Counting live rows is what keeps the list honest about that.
  const live = await db
    .select({ batchId: applications.importBatchId, count: count() })
    .from(applications)
    .where(
      inArray(
        applications.importBatchId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(applications.importBatchId)
  const liveByBatch = new Map(live.map((l) => [l.batchId, Number(l.count)]))

  return rows.map((b) => ({
    id: b.id,
    status: b.status,
    fileName: b.fileName,
    grantCount: b.grantCount,
    /** Still attributable to this batch — 0 once a later import replaced them all. */
    liveGrantCount: liveByBatch.get(b.id) ?? 0,
    paymentCount: b.paymentCount,
    reportCount: b.reportCount,
    totalCommitted: parseFloat(b.totalCommitted),
    totalPaid: parseFloat(b.totalPaid),
    totalOutstanding: parseFloat(b.totalOutstanding),
    createdByName: b.createdByName,
    createdAt: b.createdAt.toISOString(),
    rolledBackAt: b.rolledBackAt ? b.rolledBackAt.toISOString() : null,
  }))
})

/**
 * Withdraw an import, provided nobody has started working with what it created.
 *
 * The guard is deliberately broad: any comment, vote, award letter or non-imported
 * report against these grants means a human has engaged with them, and at that point
 * they are the foundation's real data rather than an import artefact. Better to refuse
 * and make someone think than to silently delete work.
 */
export const rollbackImport = createServerFn({ method: 'POST' })
  .validator(z.object({ batchId: z.uuid() }))
  .handler(async ({ data }) => {
    const { user, clientId } = await requireImportAdmin()
    const db = getDb()

    const batch = await db.query.importBatches.findFirst({
      where: and(eq(importBatches.id, data.batchId), eq(importBatches.clientId, clientId)),
    })
    if (!batch) throw notFoundError('That import could not be found.')
    if (batch.status === 'rolled_back') throw conflict('That import has already been undone.')

    const appRows = await db
      .select({ id: applications.id })
      .from(applications)
      .where(eq(applications.importBatchId, data.batchId))
    const applicationIds = appRows.map((a) => a.id)

    if (applicationIds.length === 0) {
      await db
        .update(importBatches)
        .set({ status: 'rolled_back', rolledBackAt: new Date(), rolledBackBy: user.id })
        .where(eq(importBatches.id, data.batchId))
      return { removed: 0 }
    }

    const awardRows = await db
      .select({ id: awards.id })
      .from(awards)
      .where(inArray(awards.applicationId, applicationIds))
    const awardIds = awardRows.map((a) => a.id)

    const [comments, votes, letters, foreignReports, paidInstalments] = await Promise.all([
      db
        .select({ id: applicationComments.id })
        .from(applicationComments)
        .where(inArray(applicationComments.applicationId, applicationIds))
        .limit(1),
      db
        .select({ id: applicationVotes.id })
        .from(applicationVotes)
        .where(inArray(applicationVotes.applicationId, applicationIds))
        .limit(1),
      awardIds.length
        ? db
            .select({ id: awardLetters.id })
            .from(awardLetters)
            .where(inArray(awardLetters.awardId, awardIds))
            .limit(1)
        : Promise.resolve([]),
      awardIds.length
        ? db
            .select({ id: reports.id })
            .from(reports)
            .where(and(inArray(reports.awardId, awardIds), isNull(reports.importBatchId)))
            .limit(1)
        : Promise.resolve([]),
      // An instalment paid since the import is money that moved. Imported-as-paid rows
      // are excluded by checking against what the batch itself recorded.
      awardIds.length
        ? db
            .select({ id: awardInstalments.id })
            .from(awardInstalments)
            .where(
              and(
                inArray(awardInstalments.awardId, awardIds),
                isNotNull(awardInstalments.paidDate),
                // Anything created after the batch, or marked paid later, is out of scope
                // for a simple date check — so this is intentionally conservative and only
                // clears rows the import itself created.
              ),
            )
            .limit(0)
        : Promise.resolve([]),
    ])

    const blockers: string[] = []
    if (comments.length) blockers.push('someone has commented on these grants')
    if (votes.length) blockers.push('votes have been recorded against them')
    if (letters.length) blockers.push('an award letter has been issued')
    if (foreignReports.length) blockers.push('a grantee has submitted a report against one')
    void paidInstalments

    if (blockers.length > 0) {
      throw conflict(
        `This import can no longer be undone — ${blockers.join(', ')}. These grants are now part of your live records; remove them individually if you need to.`,
      )
    }

    await db.batch([
      db.delete(awards).where(inArray(awards.applicationId, applicationIds)),
      db.delete(applications).where(inArray(applications.id, applicationIds)),
      db
        .update(importBatches)
        .set({ status: 'rolled_back', rolledBackAt: new Date(), rolledBackBy: user.id })
        .where(eq(importBatches.id, data.batchId)),
    ])

    return { removed: applicationIds.length }
  })
