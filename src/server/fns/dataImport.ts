import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { getDb } from '../db'
import {
  applicationComments,
  applicationVotes,
  auditLog,
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
import { matchBlankReferences } from '../../lib/dataImport/identity'
import {
  grantThemes,
  resolveThemeValues,
  themeCandidates,
  themeMismatchIssues,
} from '../../lib/dataImport/themes'
import {
  validateImport,
  type ExistingReference,
  type ValidationIssue,
} from '../../lib/dataImport/validate'
import { CommitImportSchema, ImportPayloadSchema } from '../../lib/validators/dataImport'
import type { GrantRow } from '../../lib/dataImport/parse'
import { impactUnitLabel } from '../../lib/impactUnits'
import { enqueue, enqueueMany } from '../pipelineQueue'
import { bankFields } from '../applications/bank'
import { resolveApplicationDeprivation } from '../applications/deprivation'
import { screenApplication } from '../applications/dueDiligence'

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

/**
 * Delete the rounds and pairings an import invented that nothing points at any more.
 *
 * Shared by the commit (where a corrected workbook has just moved grants elsewhere) and
 * by a rollback, and scoped to the CLIENT rather than to one batch. Batch scoping was
 * the obvious reading and is wrong in the case that actually happens: a round is stamped
 * with the batch that created it, while the grants inside it belong to whichever batch
 * wrote them last. Undo a re-upload and then the original, and the round carried the
 * first batch's id while the second batch's rollback was the one looking, so an empty
 * round survived both and could not be removed from any screen.
 *
 * Two conditions protect a human's work, and the second is the subtle one:
 *
 * - `import_batch_id is not null` — a round or pairing somebody made by hand is never
 *   touched, however empty it is.
 * - `budget is null` on a pairing — nothing ever clears the provenance column, so a
 *   pairing the import created and a foundation has SINCE given a budget to still reads
 *   as an artefact. It is not: setting a budget is deciding to fund that programme in
 *   that round. Without this, a live round quietly lost a programme, and the amount was
 *   nowhere in the workbook to put back.
 */
function clearEmptyImportRows(db: ReturnType<typeof getDb>, clientId: string) {
  return [
    db.delete(roundProgrammes).where(
      and(
        isNotNull(roundProgrammes.importBatchId),
        isNull(roundProgrammes.budget),
        inArray(
          roundProgrammes.roundId,
          db.select({ id: rounds.id }).from(rounds).where(eq(rounds.clientId, clientId)),
        ),
        sql`not exists (select 1 from ${applications} where ${applications.roundProgrammeId} = ${roundProgrammes.id})`,
      ),
    ),
    db.delete(rounds).where(
      and(
        eq(rounds.clientId, clientId),
        isNotNull(rounds.importBatchId),
        sql`not exists (select 1 from ${roundProgrammes} where ${roundProgrammes.roundId} = ${rounds.id})`,
      ),
    ),
  ]
}

/**
 * Turn one import into its per-grant derived work: a deprivation lookup and a registry
 * screening for every application the batch created.
 *
 * Runs in a queue consumer's own invocation (see `import_derive`), so the 40 `sendBatch`
 * calls a full-size workbook needs are spent against a fresh 50-subrequest budget rather
 * than the remains of the one that wrote the rows. Reads the applications back from the
 * batch rather than taking them in the message: a retry then acts on what is actually
 * there, and both handlers are already guarded on `pending`, so a redelivery is free.
 */
export async function fanOutImportDerivations(batchId: string): Promise<{ queued: number }> {
  const rows = await getDb()
    .select({ id: applications.id })
    .from(applications)
    .where(eq(applications.importBatchId, batchId))
  if (rows.length === 0) return { queued: 0 }

  await enqueueMany(
    rows.flatMap((a) => [
      { kind: 'deprivation' as const, applicationId: a.id },
      { kind: 'due_diligence' as const, applicationId: a.id },
    ]),
    (message) => {
      if (message.kind === 'deprivation') return resolveApplicationDeprivation(message.applicationId)
      if (message.kind === 'due_diligence') return screenApplication(message.applicationId)
      return Promise.resolve()
    },
  )
  return { queued: rows.length * 2 }
}

/** Rows per INSERT statement. Postgres allows 65,535 bound parameters per statement,
 *  and the widest row written here (`applications`) spends about nineteen. 500 leaves
 *  an order of magnitude of headroom, so adding columns cannot quietly reintroduce the
 *  limit. Empty in, nothing out: a table with no rows contributes no statement. */
const CHUNK = 500

function chunked<T>(rows: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK))
  return out
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
      .select({ id: programmes.id, name: programmes.name, tags: programmes.tags })
      .from(programmes)
      .where(eq(programmes.clientId, clientId))
      .orderBy(programmes.name),
    // Rounds in DATE order, newest first.
    //
    // Excel renders a list validation in range order, so whatever order this query
    // returns is the order a foundation scrolls through in the dropdown. Alphabetical
    // put "April Round (2024)" above "November Round (2026)", which is no order at all
    // for a thing whose only real sequence is chronological. Closing date is the key
    // because that is when a round's decisions were made, which is what an imported
    // grant belongs to; a round with no dates at all falls back to when it was created.
    //
    // ARCHIVED ROUNDS ARE INCLUDED, which is the one place in the app that departs from
    // the schema's "hidden from every picker" rule for archiving, and it is deliberate.
    // Everywhere else a round picker is about work still to do, so a retired round is
    // noise. This one is the opposite: an onboarding import is a back catalogue, and a
    // foundation's oldest grants belong to exactly the rounds they have since retired.
    // Leaving them out would offer no way to say where a 2019 grant went except to type
    // the name again, which creates a duplicate round alongside the real one.
    db
      .select({ id: rounds.id, name: rounds.name })
      .from(rounds)
      .where(eq(rounds.clientId, clientId))
      .orderBy(
        desc(sql`coalesce(${rounds.closedAt}, ${rounds.openedAt}, ${rounds.createdAt})`),
        rounds.name,
      ),
  ])

  return {
    clientId,
    foundationName: client?.name ?? 'Your foundation',
    programmes: programmeRows,
    rounds: roundRows,
  }
})

// ─── Validation pass ────────────────────────────────────────────────────────

/**
 * Every referenced grant this client holds, with what a re-upload needs to know about it.
 *
 * One query serving three jobs, because they all ask about the same rows and a second
 * trip costs a subrequest: whether a reference is taken (validation), what identifies an
 * import-owned grant to a workbook that has no references (`matchBlankReferences`), and
 * what a replace would otherwise silently null (the bank columns).
 */
type ExistingGrant = {
  id: string
  reference: string
  importedByBatch: boolean
  organisationName: string
  awardDate: string
  amountAwarded: number
  bankAccountName: string | null
  bankSortCode: string | null
  bankAccountNumber: string | null
}

async function existingGrants(clientId: string): Promise<ExistingGrant[]> {
  const rows = await getDb()
    .select({
      id: applications.id,
      reference: applications.externalApplicationId,
      importBatchId: applications.importBatchId,
      organisationName: applications.organisationName,
      // The award's own figures, which are what the workbook states. `decisionAt` is
      // written from the Award date column, so it is the same fact coming back.
      decisionAt: applications.decisionAt,
      amountAwarded: awards.amountAwarded,
      bankAccountName: applications.bankAccountName,
      bankSortCode: applications.bankSortCode,
      bankAccountNumber: applications.bankAccountNumber,
    })
    .from(applications)
    .innerJoin(roundProgrammes, eq(applications.roundProgrammeId, roundProgrammes.id))
    .innerJoin(programmes, eq(roundProgrammes.programmeId, programmes.id))
    .leftJoin(awards, eq(awards.applicationId, applications.id))
    .where(and(eq(programmes.clientId, clientId), isNotNull(applications.externalApplicationId)))

  return rows
    .filter((r) => r.reference !== null)
    .map((r) => ({
      id: r.id,
      reference: r.reference!,
      importedByBatch: r.importBatchId !== null,
      organisationName: r.organisationName ?? '',
      awardDate: r.decisionAt ? r.decisionAt.toISOString().slice(0, 10) : '',
      amountAwarded: r.amountAwarded ? Number(r.amountAwarded) : 0,
      bankAccountName: r.bankAccountName,
      bankSortCode: r.bankSortCode,
      bankAccountNumber: r.bankAccountNumber,
    }))
}

/** The shape `validateImport` wants: just who owns each reference. */
function toExistingReferences(rows: ExistingGrant[]): ExistingReference[] {
  return rows.map((r) => ({ reference: r.reference, importedByBatch: r.importedByBatch }))
}

/**
 * What a re-upload would destroy that no workbook can put back.
 *
 * `rollbackImport` refuses to undo a batch once somebody has commented, voted, sent an
 * award letter or received a report against one of its grants — those rows are the record
 * of a decision, and the whole point of the refusal is that they are not ours to delete.
 *
 * The replace path deletes the very same grants by the very same mechanism, and checked
 * none of it. All four cascade on the application or its award, so a foundation
 * re-uploading their workbook to fill in bank details could silently destroy a trustee's
 * comments, through the one route rollback exists to prevent. The guard belongs on both
 * or neither.
 *
 * Reported per grant rather than as a count, because the fix is to take those rows out of
 * the file and the foundation has to know which ones.
 */
async function protectedReplacements(
  applicationIds: string[],
): Promise<Array<{ reference: string; organisationName: string; reasons: string[] }>> {
  if (applicationIds.length === 0) return []
  const db = getDb()

  const [commentRows, voteRows, letterRows, reportRows] = await db.batch([
    db
      .select({ applicationId: applicationComments.applicationId })
      .from(applicationComments)
      .where(inArray(applicationComments.applicationId, applicationIds)),
    db
      .select({ applicationId: applicationVotes.applicationId })
      .from(applicationVotes)
      .where(inArray(applicationVotes.applicationId, applicationIds)),
    db
      .select({ applicationId: awards.applicationId })
      .from(awardLetters)
      .innerJoin(awards, eq(awardLetters.awardId, awards.id))
      .where(inArray(awards.applicationId, applicationIds)),
    // Only a report a GRANTEE sent. An import's own impact figure is a `reports` row too,
    // and it came from the workbook, so rebuilding it from the workbook loses nothing.
    db
      .select({ applicationId: awards.applicationId })
      .from(reports)
      .innerJoin(awards, eq(reports.awardId, awards.id))
      .where(and(inArray(awards.applicationId, applicationIds), isNull(reports.importBatchId))),
  ])

  const reasons = new Map<string, string[]>()
  const add = (id: string, reason: string) => {
    const list = reasons.get(id) ?? []
    if (!list.includes(reason)) list.push(reason)
    reasons.set(id, list)
  }
  for (const r of commentRows) add(r.applicationId, 'someone has commented on it')
  for (const r of voteRows) add(r.applicationId, 'a vote has been recorded against it')
  for (const r of letterRows) add(r.applicationId!, 'an award letter has been issued')
  for (const r of reportRows) add(r.applicationId!, 'a grantee has submitted a report against it')

  if (reasons.size === 0) return []

  const named = await db
    .select({
      id: applications.id,
      reference: applications.externalApplicationId,
      organisationName: applications.organisationName,
    })
    .from(applications)
    .where(inArray(applications.id, [...reasons.keys()]))

  return named.map((n) => ({
    reference: n.reference ?? '',
    organisationName: n.organisationName ?? '',
    reasons: reasons.get(n.id) ?? [],
  }))
}

/** The blocker a protected grant produces, shared by the review step and the commit. */
function protectedIssues(
  blocked: Array<{ reference: string; organisationName: string; reasons: string[] }>,
): ValidationIssue[] {
  if (blocked.length === 0) return []
  return [
    {
      kind: 'blocker',
      code: 'replace_would_discard_work',
      message: `${blocked.length === 1 ? '1 grant has' : `${blocked.length} grants have`} work in Custodian that re-importing would delete`,
      detail: `Re-importing rebuilds a grant from the workbook, and these carry things no workbook holds: ${blocked
        .slice(0, 5)
        .map((b) => `${b.organisationName || b.reference} (${b.reasons.join(', ')})`)
        .join('; ')}. Remove those rows from the file and upload the rest.`,
      rows: [],
    },
  ]
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
        .select({ id: programmes.id, name: programmes.name, tags: programmes.tags })
        .from(programmes)
        .where(eq(programmes.clientId, clientId)),
      db
        .select({ id: rounds.id, name: rounds.name })
        .from(rounds)
        .where(eq(rounds.clientId, clientId)),
      existingGrants(clientId),
    ])

    const validation = validateImport({
      ...data,
      existingReferences: toExistingReferences(existing),
    })

    // Blank-reference rows, resolved against what we already hold. Done here as well as
    // at commit so the review screen's "will be updated" count is the count that happens.
    const importOwned = existing.filter((e) => e.importedByBatch)
    const blankMatch = matchBlankReferences(data.grants, importOwned)

    const replacingRefs = new Set<string>()
    for (const g of data.grants) {
      const reference = g.reference.trim() || blankMatch.byRow.get(g.rowNumber)
      if (!reference) continue
      const hit = importOwned.find((e) => e.reference.toLowerCase() === reference.toLowerCase())
      if (hit) replacingRefs.add(hit.reference.toLowerCase())
    }
    const replacingIds = importOwned
      .filter((e) => replacingRefs.has(e.reference.toLowerCase()))
      .map((e) => e.id)

    const blocked = await protectedReplacements(replacingIds)
    const replaceIssues = protectedIssues(blocked)

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

    // The Themes column, per distinct value like the two above — plus the one check those
    // don't need: a real theme belonging to a DIFFERENT programme than the grant's.
    const themeResolutions = resolveThemeValues(data.grants, programmeRows)
    const themeIssues = themeMismatchIssues(
      data.grants,
      programmeRows,
      programmeResolutions,
      themeResolutions,
    )

    return {
      ...validation,
      issues: [...validation.issues, ...themeIssues, ...replaceIssues],
      canCommit: validation.canCommit && themeIssues.length === 0 && replaceIssues.length === 0,
      programmes: programmeRows,
      rounds: roundRows,
      /** Every theme the foundation has, for the review screen's theme picker. */
      themes: themeCandidates(programmeRows).map((c) => c.name),
      resolutions: {
        programmes: programmeResolutions,
        rounds: roundResolutions,
        themes: themeResolutions,
      },
      /**
       * Grants already imported that this file will replace — by reference, or by
       * identity where the file carries no references. Counted off the SAME resolution
       * the commit uses, so the number on the review screen is the number that happens.
       */
      replacing: replacingIds.length,
      /**
       * Blank-reference rows that matched nothing and will be added as new grants. On a
       * first import that is simply every row; on a re-upload it is the ones we could not
       * recognise, which is the only warning a foundation with no references of its own
       * can be given before they end up with a grant twice.
       */
      addingWithoutReference: blankMatch.unmatchedRows.length,
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
    const existing = await existingGrants(clientId)
    const validation = validateImport({
      ...payload,
      existingReferences: toExistingReferences(existing),
    })
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
      .select({
        id: programmes.id,
        name: programmes.name,
        impactUnit: programmes.impactUnit,
        impactUnitLabel: programmes.impactUnitLabel,
        tags: programmes.tags,
      })
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

    // Every decision date in each round, ascending — what a round created below is
    // dated from. ISO day strings, so they sort as text.
    const awardDatesByRound = new Map<string, string[]>()
    for (const grant of payload.grants) {
      const key = grant.round.trim().toLowerCase()
      const list = awardDatesByRound.get(key) ?? []
      list.push(grant.awardDate)
      awardDatesByRound.set(key, list)
    }
    for (const list of awardDatesByRound.values()) list.sort()

    // ── Resolve themes ──
    //
    // Same door rule as programmes: every theme the mapping names must be one this
    // client actually has. Then each grant is checked against its OWN programme, which
    // the review screen could not do for a value a human confirmed — refused, not
    // dropped, so a theme never goes missing without anyone being told.
    const ownThemes = new Set(
      ownProgrammes.flatMap((p) => (p.tags ?? []).map((t) => t.trim().toLowerCase())),
    )
    for (const theme of Object.values(mapping.themes)) {
      if (theme != null && !ownThemes.has(theme.trim().toLowerCase())) {
        throw badRequest(`“${theme}” is not one of your themes.`)
      }
    }
    const themesByRow = new Map<number, string[]>()
    for (const grant of payload.grants) {
      const programme = programmeById.get(
        programmeIdFor.get(grant.programme.trim().toLowerCase())!,
      )!
      const { themes, outside, undecided } = grantThemes(grant, programme.tags, mapping.themes)
      if (undecided.length > 0) {
        throw badRequest(`No theme was chosen for “${undecided[0]}”.`)
      }
      if (outside.length > 0) {
        throw badRequest(
          `Row ${grant.rowNumber}: “${outside[0]}” is not one of ${programme.name}’s themes. Choose a different theme for it, or leave it out.`,
        )
      }
      themesByRow.set(grant.rowNumber, themes)
    }

    // ── Round-programme pairings ──
    //
    // An application must hang off a (round, programme) pairing. Historic pairings
    // mostly won't exist, and they are created with NO budget — a budget is a
    // forward-looking control on a round you are still deciding, and inventing a number
    // for a round that closed in 2019 would be worse than saying nothing. NULL says
    // exactly that; the £0 it replaced read as a budget of nothing, which is why the
    // Rounds screen showed "£4.1k committed of £0" on a round that was never overspent.
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
    //
    // A row with no reference of its own is matched on who/when/how much first, so a
    // foundation that took the template's advice to leave the column blank can re-upload
    // at all. Without it their second upload matched nothing, replaced nothing, and
    // minted a fresh set of IMP- references beside the first — the portfolio twice over.
    const importOwned = existing.filter((e) => e.importedByBatch)
    const blankMatch = matchBlankReferences(payload.grants, importOwned)

    const incomingRefs = new Set(
      payload.grants
        .map((g) => (g.reference.trim() || blankMatch.byRow.get(g.rowNumber) || '').toLowerCase())
        .filter(Boolean),
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

    // Re-checked here as well as at the review step, because this is the boundary and
    // the review step's answer is a browser round-trip old. A comment left in between is
    // exactly the case the guard is for.
    const blocked = await protectedReplacements(replacingIds)
    if (blocked.length > 0) {
      throw conflict(
        `These grants have work in Custodian that re-importing would delete: ${blocked
          .map((b) => `${b.organisationName || b.reference} (${b.reasons.join(', ')})`)
          .join('; ')}. Remove those rows from the workbook and upload the rest.`,
      )
    }

    // What a replace must not silently null. The bank columns are the case that bites:
    // they were not a workbook column until recently, so every batch imported before then
    // has them held in Custodian and absent from the file by definition. A blank cell is
    // the foundation saying nothing about a payment instruction, not asking us to delete
    // one. Set them in the sheet to change them; clear them on the grant to clear them.
    const bankByReference = new Map(
      existing.map((e) => [
        e.reference.toLowerCase(),
        {
          bankAccountName: e.bankAccountName,
          bankSortCode: e.bankSortCode,
          bankAccountNumber: e.bankAccountNumber,
        },
      ]),
    )

    // What a replace must not silently UNPAY.
    //
    // Same rule as the bank columns above, and the case is sharper. A foundation imports
    // its live grants, Finance pays the next instalment, and somebody then re-uploads the
    // workbook to correct a delivery area. That workbook was written before the payment
    // and still says the instalment is unpaid, so the replace wrote it back as unpaid and
    // the payment record was gone: no warning, no audit row, and the only copy of "this
    // money went out on the 28th" was the row that had just been deleted.
    //
    // A workbook saying "No" in a Paid? column is a file that is out of date, not an
    // instruction to reverse a payment. Reversing one is a deliberate act on the grant
    // itself (`setInstalmentPaid`), and it writes an audit row. So a held payment is
    // carried across, matched on the pair that identifies a schedule row: its due date
    // and its amount.
    type HeldPayment = { dueDate: string | null; amount: number; paidDate: string }
    const heldPayments = new Map<string, HeldPayment[]>()
    if (replacingIds.length > 0) {
      const rows = await db
        .select({
          reference: applications.externalApplicationId,
          dueDate: awardInstalments.dueDate,
          amount: awardInstalments.amount,
          paidDate: awardInstalments.paidDate,
        })
        .from(awardInstalments)
        .innerJoin(awards, eq(awards.id, awardInstalments.awardId))
        .innerJoin(applications, eq(applications.id, awards.applicationId))
        .where(
          and(inArray(awards.applicationId, replacingIds), isNotNull(awardInstalments.paidDate)),
        )
      for (const r of rows) {
        if (!r.reference || !r.paidDate) continue
        const key = r.reference.toLowerCase()
        const list = heldPayments.get(key) ?? []
        list.push({ dueDate: r.dueDate, amount: Number(r.amount), paidDate: r.paidDate })
        heldPayments.set(key, list)
      }
    }

    /**
     * The date a held payment went out, for an incoming row this file says is unpaid.
     *
     * Matched on the pair that identifies a schedule row, its due date and its amount,
     * and CONSUMED on a hit so two identical instalments cannot both claim one payment.
     * No match means the file has restructured the schedule, and a row that is not the
     * row that was paid must not inherit its date.
     */
    const carriedPayments: string[] = []
    const heldPaidDate = (reference: string, dueDate: string, amount: number): string | null => {
      const held = heldPayments.get(reference.toLowerCase())
      if (!held) return null
      const at = held.findIndex(
        (h) => h.dueDate === dueDate && Math.abs(h.amount - amount) < 0.005,
      )
      if (at === -1) return null
      const [hit] = held.splice(at, 1)
      carriedPayments.push(reference)
      return hit!.paidDate
    }

    // ── Build the rows ──

    const batchId = crypto.randomUUID()
    // One clock for the whole import, so every row it stamps agrees with every other.
    const importedAt = new Date()
    // Everything a minted IMP- number must not collide with: what this client already
    // holds and is not about to be replaced, AND the references the file itself states.
    //
    // The second half is not hypothetical. We generate IMP- numbers, tell the foundation
    // to keep the list because a grantee has to quote one, and they paste them back into
    // the next workbook — beside new rows still left blank. Without this, row two's blank
    // cell mints "IMP-0001" while row one states it, and one import writes two grants
    // under one reference: the payments join is then ambiguous and the next re-upload
    // replaces whichever it finds first.
    const usedReferences = new Set([
      ...existing
        .filter((e) => !incomingRefs.has(e.reference.toLowerCase()))
        .map((e) => e.reference.toLowerCase()),
      ...payload.grants.map((g) => g.reference.trim().toLowerCase()).filter(Boolean),
    ])

    let generatedCounter = 0
    const referenceFor = (grant: GrantRow): string => {
      if (grant.reference) return grant.reference
      // A blank row we recognised keeps the reference it already has, so it replaces
      // that grant instead of arriving beside it under a fresh IMP- number.
      const matched = blankMatch.byRow.get(grant.rowNumber)
      if (matched) return matched
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
      if (!grant.reference && !blankMatch.byRow.has(grant.rowNumber)) {
        generatedReferences.push({ organisationName: grant.organisationName, reference })
      }
      const heldBank = bankByReference.get(reference.toLowerCase())

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
        // The workbook's Themes, or every theme the programme has where the cell was
        // blank. Stated by the foundation, like the purpose above — the model that picks
        // themes for a live application never runs on an imported one.
        themes: themesByRow.get(grant.rowNumber) ?? [],
        status: 'awarded',
        // Deliberately left at their defaults (`pending`): due diligence and the
        // deprivation lookup re-derive themselves from the registration number and the
        // delivery area we just imported. Importing stale results would be worse than
        // useless. The Custodian score stays pending forever — scoring a 2019
        // application against goals written in 2026 would be a confident, meaningless
        // number, so no score is the honest answer.
        submittedAt: decisionAt,
        decisionAt,
        // Optional in the workbook, and blank on most of a back catalogue. Where they
        // ARE given, they go on through `bankFields` like every other writer, so the
        // cached `bank_check_status` is computed rather than left at its default and
        // Finance can sort by it the moment the import lands. Where they are blank on a
        // grant being REPLACED, whatever Finance holds is carried across rather than
        // nulled — see `bankByReference`.
        ...bankFields({
          bankSortCode: grant.bankSortCode ?? heldBank?.bankSortCode ?? null,
          bankAccountNumber: grant.bankAccountNumber ?? heldBank?.bankAccountNumber ?? null,
        }),
        bankAccountName: grant.bankAccountName ?? heldBank?.bankAccountName ?? null,
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
          .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
          .forEach((p, i) => {
            instalmentRows.push({
              id: crypto.randomUUID(),
              awardId,
              instalmentNo: i + 1,
              amount: String(p.amount),
              dueDate: p.dueDate,
              // A payment marked paid with no date still counts as paid — the client was
              // warned it loses its place on a timeline, and dropping the fact of payment
              // would be far worse than losing the date. A row the FILE says is unpaid
              // keeps a payment Custodian is already holding for it: see `heldPaidDate`.
              paidDate: p.paid
                ? (p.paidDate ?? p.dueDate)
                : heldPaidDate(reference, p.dueDate, p.amount),
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
      // `submittedDate` is what makes a milestone met, so a report answered "Yes" with
      // no date falls back to the due date rather than staying null — same rule as a
      // payment marked paid with no date, and for the same reason: the fact is worth
      // more than the precision. The client was warned.
      const receivedOn = milestones.map((m) => (m.received ? (m.receivedDate ?? m.dueDate) : null))
      milestones.forEach((m, i) => {
        scheduleRows.push({
          id: scheduleIds[i]!,
          awardId,
          label: m.label,
          dueDate: m.dueDate,
          submittedDate: receivedOn[i]!,
        })
      })

      // A milestone answered "Yes" needs a `reports` row of its own, not just a date on
      // the schedule. The Reports screen is two lists and a row belongs to exactly one:
      // `arrivedQuery` reads `reports`, `outstandingQuery` reads schedule rows with
      // nothing submitted against them. A milestone with a `submittedDate` and no report
      // is in NEITHER — the foundation ticked "received" and watched the milestone
      // disappear off both halves of the screen.
      //
      // The row carries no narrative because none was imported (the template asks for
      // milestones and dates, not documents), and no AI analysis for the same reason.
      // It is dated the day the report actually arrived — NOT, as it was, the day the
      // grant was awarded, which put every imported report on the decision date and
      // labelled the ones that answered nothing "Unscheduled report".
      const received = receivedOn
        .map((on, i) => ({ i, on }))
        .filter((r): r is { i: number; on: string } => r.on !== null)
      // The impact figure is "so far", so it belongs on the LAST report received — that
      // is the one Insights reads (`latestWithQuantity`) and the one a reader would look
      // to for the current total. Dates are `yyyy-mm-dd`, so they compare as strings.
      const carriesImpact =
        grant.impactQuantity == null
          ? null
          : received.reduce<{ i: number; on: string } | null>(
              (latest, r) => (latest === null || r.on >= latest.on ? r : latest),
              null,
            )
      const unitLabel = impactUnitLabel(programme.impactUnit, programme.impactUnitLabel)

      /** The impact half of a report row — only ever on one row per grant. */
      const impactFields = () => ({
        impactQuantity: String(grant.impactQuantity),
        impactQuantitySource: 'reported',
        impactUnitLabel: unitLabel,
      })
      /** Everything a report row copies off the grant it belongs to. */
      const reportBase = () => ({
        id: crypto.randomUUID(),
        clientId,
        awardId,
        matchMethod: 'import' as const,
        externalApplicationId: reference,
        organisationName: grant.organisationName,
        charityNumber: grant.charityNumber,
        companyNumber: grant.companyNumber,
        analysisStatus: 'pending' as const,
        importBatchId: batchId,
      })

      for (const r of received) {
        const carries = carriesImpact !== null && carriesImpact.i === r.i
        reportRows.push({
          ...reportBase(),
          scheduleId: scheduleIds[r.i]!,
          impactSummary: carries
            ? 'Impact figure supplied by the foundation when its historic grants were imported. The report itself was not imported.'
            : 'Recorded as received when this grant was imported. The report itself was not imported.',
          ...(carries ? impactFields() : {}),
          submittedAt: new Date(`${r.on}T00:00:00Z`),
        })
      }

      // A figure with no report to ride on: the foundation knows what the grant has
      // achieved so far without having received anything on paper, which the template
      // invites ("Any impact recorded for this grant so far"). It is still worth having
      // — Insights is the reason this row exists at all — but it is NOT a report that
      // arrived, so it says what it is and is dated the import rather than borrowing a
      // milestone's date or the award's. `isArrivedReport` keeps it out of the Reports
      // library and its counts; it is visible on the grant it belongs to.
      if (grant.impactQuantity != null && carriesImpact === null) {
        reportRows.push({
          ...reportBase(),
          scheduleId: null,
          impactSummary:
            'Impact figure supplied by the foundation when its historic grants were imported. No report has been received for this grant.',
          ...impactFields(),
          submittedAt: importedAt,
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
          newRounds.map((r) => {
            // Dated from the decisions made in it, NOT from the clock.
            //
            // Stamping `new Date()` made every historic round the most recent round the
            // foundation had ever run, all tied to the millisecond. Applications defaults
            // to the latest round by `openedAt`, so it landed on one of eleven 2021-2024
            // rounds at random and changed its mind on every load, and the live round
            // looked like it had been deleted. The same tie put the round pill, the
            // Rounds screen and Insights' commitment-over-time in no order at all.
            //
            // An award date is the day a decision was made, and it is required on every
            // grant row, so a round created here always has one. Closing on the LAST of
            // them is the honest reading: a round closes when its decisions are made.
            // Opening on the first is the best available guess — real applications opened
            // earlier, and nothing in the workbook says when.
            const dates = awardDatesByRound.get(r.name.trim().toLowerCase()) ?? []
            const opened = dates[0]
            const closed = dates[dates.length - 1]
            return {
              id: r.id,
              clientId,
              name: r.name,
              // Whose invention this was — see `rounds.import_batch_id`. It is what
              // lets an empty one be taken away again.
              importBatchId: batchId,
              // A historic round is closed by definition — it is being imported because
              // its decisions were made. Leaving it open would put finished grants in the
              // round pickers on Applications and Shortlist.
              openedAt: opened ? new Date(opened) : new Date(),
              closedAt: closed ? new Date(closed) : new Date(),
            }
          }),
        ),
      )
    }
    if (newPairs.length > 0) {
      statements.push(
        db.insert(roundProgrammes).values(
          newPairs.map((p) => ({ ...p, budget: null, importBatchId: batchId })),
        ),
      )
    }

    // Multi-row inserts, in chunks, because a statement may carry at most 65,535 bound
    // parameters. One row of `applications` is ~19 of them, so a single insert gave out
    // at about 3,400 grants with "too many query parameters" — a raw Postgres error, at
    // the end of a long manual process, on a workbook the schema had already accepted.
    // Worse, the ceiling moves every time a column is added, so it cannot be reasoned
    // about from the row cap alone. `CHUNK` is the same for every table and is set well
    // under the limit of the widest one; the statements still go in one `db.batch`, so
    // this changes how the write is spelled and not whether it is atomic.
    for (const chunk of chunked(applicationRows)) statements.push(db.insert(applications).values(chunk))
    for (const chunk of chunked(awardRows)) statements.push(db.insert(awards).values(chunk))
    for (const chunk of chunked(instalmentRows))
      statements.push(db.insert(awardInstalments).values(chunk))
    for (const chunk of chunked(scheduleRows)) statements.push(db.insert(reportSchedule).values(chunk))
    for (const chunk of chunked(reportRows)) statements.push(db.insert(reports).values(chunk))

    // ── Tidy up what an earlier import invented and this one no longer needs ──
    //
    // Re-uploading is the phasing mechanism, and a corrected workbook routinely moves a
    // grant to a different round. The old round was only ever created to hang that grant
    // off, so once nothing hangs off it, it is an empty label in every round picker the
    // foundation has, and rounds cannot be deleted from the UI. That is where "July 2022"
    // and "April 2025" came from on a real portfolio: rounds nobody had ever run.
    //
    // Only ever import-created rows, only ever when genuinely empty, and last in the
    // batch so the rows this import just wrote are already in place and count.
    statements.push(...clearEmptyImportRows(db, clientId))

    await db.batch(statements as [any, ...any[]])

    // Deliberately NO audit_log rows and NO award letters. The feed reads by date, so
    // writing one entry per grant would show 127 awards "made today"; and an import that
    // emailed award letters would notify 127 charities about grants they received years
    // ago. Both are stated here because both are catastrophic and easy to add by reflex.

    // Deprivation and due diligence ARE run, on the queue, once the rows are committed.
    //
    // Both are derivations from what the workbook just gave us, and both are wrong to
    // leave undone. "Where the impact happens" is a REQUIRED template column and the one
    // cell that drives the whole deprivation and regional picture, so an unresolved
    // import left Insights blank for a foundation that had just handed us its portfolio.
    // The registration numbers are the same: a charity removed from the register was
    // removed whether or not the grant was made in 2019, and the foundation still paying
    // its instalments is the one that wants to know.
    //
    // Neither can run inline. A hundred grants is a hundred geocodes plus several
    // hundred registry calls, far past both the 30-second post-response ceiling and the
    // 50-subrequest budget. Two messages per grant, sent with `sendBatch`, so the whole
    // catalogue costs a handful of subrequests rather than one per call — and separate
    // kinds rather than one "finish this import" verb, so a Companies House outage
    // retries the screening without re-geocoding anything.
    //
    // Still NOT run: the Custodian score. It judges an application against a programme's
    // goals, and a 2019 application against goals written in 2026 is a confident,
    // meaningless number. That is the line — a check of the world as it is today is
    // worth running late; a judgement of a decision already made is not.
    // ONE message, whatever the size of the workbook. See `import_derive`: sending the
    // two-per-grant messages from here cost a subrequest per hundred of them, and at
    // the top of the range that ran the invocation out of budget and silently dropped
    // the lot. `fanOutImportDerivations` does it from a consumer invocation instead.
    await enqueue({ kind: 'import_derive', batchId }, () => fanOutImportDerivations(batchId))

    return {
      batchId,
      grants: applicationRows.length,
      payments: instalmentRows.length,
      reportMilestones: scheduleRows.length,
      replaced: replacingIds.length,
      /** Payments Custodian was holding that this file would otherwise have unpaid. */
      paymentsKept: carriedPayments.length,
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
      // A batch whose grants a later upload already replaced. There is nothing to
      // delete, but the rounds it invented may now be the empty ones: this is the exact
      // path that used to return before reaching the cleanup at all.
      await db.batch([
        db
          .update(importBatches)
          .set({ status: 'rolled_back', rolledBackAt: new Date(), rolledBackBy: user.id })
          .where(eq(importBatches.id, data.batchId)),
        ...clearEmptyImportRows(db, clientId),
      ])
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
      // An instalment paid since the import is money that moved, and undoing the import
      // deletes the only record of it.
      //
      // The check is on `audit_log`, not on the instalment: a historic import writes
      // paid instalments by the hundred, so "has a paid instalment" says nothing, and
      // nothing on the row says who paid it or when they said so. An import writes NO
      // audit rows, deliberately (the feed would show 127 awards made today), so an
      // audit row against one of these grants is by construction a human acting in
      // Custodian. `setInstalmentPaid` writes one on both the payment and its reversal.
      //
      // This guard was declared in a comment here and never applied: the query carried
      // `.limit(0)`, so it could only ever come back empty, and its result was `void`ed
      // before the blockers were assembled.
      //
      // It leans on the audit row, and `recordAudit` swallows its own failures so that an
      // audit problem can never block a payment. A payment whose audit write failed is
      // therefore undoable. That is the right way round: the alternative is a guard that
      // reads the instalment alone, which cannot tell a payment somebody made this
      // morning from the hundreds the same import wrote, and would make every historic
      // import permanently un-undoable.
      db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            inArray(auditLog.applicationId, applicationIds),
            inArray(auditLog.action, ['grant_payment_recorded', 'grant_payment_reversed']),
          ),
        )
        .limit(1),
    ])

    const blockers: string[] = []
    if (comments.length) blockers.push('someone has commented on these grants')
    if (votes.length) blockers.push('votes have been recorded against them')
    if (letters.length) blockers.push('an award letter has been issued')
    if (foreignReports.length) blockers.push('a grantee has submitted a report against one')
    if (paidInstalments.length) blockers.push('a payment has been recorded against one in Custodian')

    if (blockers.length > 0) {
      throw conflict(
        `This import can no longer be undone: ${blockers.join(', ')}. These grants are now part of your live records; remove them individually if you need to.`,
      )
    }

    await db.batch([
      db.delete(awards).where(inArray(awards.applicationId, applicationIds)),
      db.delete(applications).where(inArray(applications.id, applicationIds)),
      // The rounds and pairings an import invented go with the grants. Undoing an
      // import that left eleven rounds behind is not an undo: they are in every round
      // picker the foundation has, and nothing in the UI can remove a round. Scoped to
      // the client rather than this batch, and to rows nothing points at any more — see
      // `clearEmptyImportRows` for why both of those are load-bearing.
      ...clearEmptyImportRows(db, clientId),
      db
        .update(importBatches)
        .set({ status: 'rolled_back', rolledBackAt: new Date(), rolledBackBy: user.id })
        .where(eq(importBatches.id, data.batchId)),
    ])

    return { removed: applicationIds.length }
  })
