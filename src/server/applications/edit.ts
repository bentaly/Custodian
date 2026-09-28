// ─── Editing an application: the IO half ─────────────────────────────────────
//
// See `lib/applicationEdit.ts` for what may be edited and why. This is the write: it
// changes the application ROW (the truth), keeps the ingest's mapping in step so the
// admin app and a later re-confirm agree with it, records who changed what in
// `application_edits`, and re-derives whatever read the changed fields through
// `updateApplicationFromCanonical`, the same engine the admin app's Confirm uses.
//
// The assessment is the one derived feature with a policy of its own: an edit never
// re-runs it. People fix several things in a row and each run is a paid model call, so
// the screen offers "Re-run the assessment" once something it reads has changed, and
// `rerunBlocker` limits that (not after a trustee has voted, three a day). The one
// automatic run is the first, when an application waiting for its amount gets one.
// The area lookup and the register checks still re-run on every edit that changes
// their inputs: they are cheap, and a stale decile beside a corrected area is wrong.

import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { getDb } from '../db'
import {
  applicationEdits,
  applicationIngests,
  applicationVotes,
  applications,
  auditLog,
  fieldMappings,
  programmes,
  roundProgrammes,
} from '../../../drizzle/schema'
import { conflict, notFoundError } from '../../lib/errors'
import {
  canonicalFromApplication,
  editableFieldLabel,
  fieldText,
  isEditableField,
  moveAnswer,
  setField,
  strictReading,
  type EditableField,
} from '../../lib/applicationEdit'
import { toStringValue } from '../../lib/fieldMapping'
import {
  CreateApplicationSchema,
  type CreateApplicationInput,
} from '../../lib/validators/application'
import { fetchRoundProgrammeForApplication, updateApplicationFromCanonical } from './create'
import { scoreApplication } from './score'
import { enqueue, enqueueMany, type PipelineMessage } from '../pipelineQueue'
import { recordAudit } from '../audit'
import { orderedKeys } from '../fieldMapping/assemble'

/** One field to change. `sourceKey` = "read it from this answer of theirs". */
export interface FieldChange {
  field: EditableField
  /**
   * The value to store. With `sourceKey` it is the person's reading of that answer
   * (the answer picker prefills it and lets them correct "58k across three years" to
   * 58000); without, it is what they typed. Empty clears the field.
   */
  value: string | null
  sourceKey?: string
}

export interface EditResult {
  /** Derived features re-run, for the screen to say what happened. */
  rerun: string[]
  /** The assessment was queued and is on its way. */
  scoreQueued: boolean
  /** The assessment was deliberately left alone because a decision is under way. */
  scoreKept: boolean
  /** Other applications being filled in from the same answer. */
  appliedToOthers: number
}

type Actor = { id: string }

/**
 * Why this application can no longer be edited, or null. One statement of the rule for
 * the screen (a greyed pencil with this as its tooltip) and the boundary (`loadForEdit`).
 *
 *   - Once a trustee has voted: they voted on the application as it read then, and
 *     changing it under them (and under the trustees still to vote) would mean the board
 *     decided on different applications. Deliberately earlier than money.
 *   - Once awarded: the award letter was written from these figures, the same line the
 *     admin app's re-confirm draws.
 */
export async function editLockReason(app: {
  id: string
  status: string
  award?: { id: string } | null
}): Promise<string | null> {
  if (app.award || app.status === 'awarded') {
    return 'This application has been awarded, so its details can no longer be edited.'
  }
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(applicationVotes)
    .where(eq(applicationVotes.applicationId, app.id))
  if ((row?.n ?? 0) > 0) {
    return 'Trustees have voted on this application, so its details can no longer be edited.'
  }
  return null
}

async function loadForEdit(applicationId: string) {
  const app = await getDb().query.applications.findFirst({
    where: eq(applications.id, applicationId),
    with: { award: { columns: { id: true } } },
  })
  if (!app) throw notFoundError()
  const locked = await editLockReason(app)
  if (locked) throw conflict(locked)
  const ingest = await getDb().query.applicationIngests.findFirst({
    where: eq(applicationIngests.applicationId, applicationId),
  })
  return { app, ingest: ingest ?? null }
}

/**
 * Change one or more fields of an application in one save. All or nothing: every
 * change is applied to the input and the whole thing validated before anything is
 * written, so a bad email alongside a good amount saves neither.
 */
export async function editApplication(params: {
  applicationId: string
  changes: FieldChange[]
  actor: Actor
  /** With a `sourceKey` change: teach the foundation's mapping. */
  remember?: boolean
  /** With a `sourceKey` change: fill in the others that answered the same question. */
  applyToOthers?: boolean
  /** How the change arrived, for the edit row. Internal: the queue handler passes `applied`. */
  method?: 'applied'
}): Promise<EditResult> {
  const { applicationId, changes, actor } = params
  if (changes.length === 0) {
    return { rerun: [], scoreQueued: false, scoreKept: false, appliedToOthers: 0 }
  }
  for (const c of changes) {
    if (!isEditableField(c.field)) throw conflict(`${c.field} cannot be edited.`)
  }

  // Taken BEFORE anything is written, on the same clock the assessment stamps
  // `custodian_scored_at` with. The database's own now() is a different clock, and an edit
  // it stamped could land a few milliseconds AFTER the assessment it triggered had
  // started, reading as a change made since, and offering a pointless Re-run.
  const editedAt = new Date()
  const { app, ingest } = await loadForEdit(applicationId)
  const payload = ingest?.rawPayload ?? {}
  const order = ingest ? orderedKeys(payload, ingest.fieldOrder) : []
  // The ingest's mapping, `sourceKey -> canonical`, kept in step with the row.
  const mapping: Record<string, string> = { ...(ingest?.resolved ?? {}) }
  const provided: Record<string, string> = { ...(ingest?.providedValues ?? {}) }
  const sourceKeyFor = (field: string) =>
    Object.entries(mapping).find(([, canonical]) => canonical === field)?.[0] ?? null

  let input = canonicalFromApplication(app)
  let responses = input.responses
  let submittedFields = input.submittedFields
  const rows: Array<typeof applicationEdits.$inferInsert> = []

  for (const change of changes) {
    const previousValue = fieldText(input, change.field)
    const replacedSourceKey = sourceKeyFor(change.field)

    if (change.sourceKey !== undefined) {
      if (!ingest || !(change.sourceKey in payload)) {
        throw conflict('That answer is not part of this submission.')
      }
      if (mapping[change.sourceKey] && mapping[change.sourceKey] !== change.field) {
        throw conflict(
          `That answer is already read as ${editableFieldLabelSafe(mapping[change.sourceKey]!)}.`,
        )
      }
    }

    const set = setField(input, change.field, change.value)
    if (!set.ok) throw conflict(set.message)
    input = set.input
    const newValue = fieldText(input, change.field)
    if (newValue === previousValue && change.sourceKey === (replacedSourceKey ?? undefined)) {
      continue
    }

    // Keep the ingest's picture of the submission in step: which answer feeds the field
    // (so the admin app and the answer picker agree with the screen) and which typed
    // values stand in for an answer.
    if (ingest) {
      if (replacedSourceKey && replacedSourceKey !== change.sourceKey) {
        delete mapping[replacedSourceKey]
      }
      if (change.sourceKey !== undefined) {
        mapping[change.sourceKey] = change.field
        // A typed value only where the person's reading differs from the answer's
        // plain reading, so a re-confirm reproduces what they chose.
        const plain = strictReading(change.field, payload[change.sourceKey])
        if (newValue !== null && plain !== newValue) provided[change.field] = newValue
        else delete provided[change.field]
      } else if (newValue === null) {
        delete provided[change.field]
      } else {
        provided[change.field] = newValue
      }
      const moved = moveAnswer({
        responses,
        submittedFields,
        payload,
        order,
        field: change.field,
        consume: change.sourceKey ?? null,
        release:
          replacedSourceKey && replacedSourceKey !== change.sourceKey ? replacedSourceKey : null,
      })
      responses = moved.responses
      submittedFields = moved.submittedFields
    }

    rows.push({
      applicationId,
      field: change.field,
      method: params.method ?? (change.sourceKey !== undefined ? 'answer' : 'typed'),
      previousValue,
      newValue,
      sourceKey: change.sourceKey ?? null,
      replacedSourceKey:
        replacedSourceKey && replacedSourceKey !== change.sourceKey ? replacedSourceKey : null,
      editedBy: actor.id,
      createdAt: editedAt,
    })
  }

  if (rows.length === 0) {
    return { rerun: [], scoreQueued: false, scoreKept: false, appliedToOthers: 0 }
  }

  input = { ...input, responses, submittedFields }
  const parsed = CreateApplicationSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    const key = String(issue.path[0] ?? '')
    const label = isEditableField(key) ? editableFieldLabel(key) : key
    throw conflict(`${label}: ${issue.message}`)
  }

  const roundProgramme = await fetchRoundProgrammeForApplication(app.roundProgrammeId)
  if (!roundProgramme) throw notFoundError()

  // An edit never re-runs an assessment by itself: a person usually fixes several things
  // in a row, and each re-run is a paid model call. They press Re-run when they are done
  // (`rescoreApplication`). The one exception is the FIRST assessment of an application
  // that was waiting for its amount, which was only ever waiting for this.
  const firstAssessment = app.custodianScoreStatus === 'waiting'
  const { rerun, scoreQueued, scoreInputsChanged } = await updateApplicationFromCanonical(
    roundProgramme,
    applicationId,
    parsed.data,
    { score: firstAssessment ? 'queued' : 'keep' },
  )
  // Something the assessment reads changed and it was not re-run: the screen says so.
  const keep = !scoreQueued && scoreInputsChanged && app.amountRequested !== null

  // The record of the change and the ingest's mapping are one fact, so one batch. The
  // row itself was written by `updateApplicationFromCanonical` above, which owns that
  // write for every path that re-derives an application.
  const db = getDb()
  const recordEdits = db.insert(applicationEdits).values(rows)
  if (ingest) {
    await db.batch([
      recordEdits,
      db
        .update(applicationIngests)
        .set({ resolved: mapping, providedValues: provided })
        .where(eq(applicationIngests.id, ingest.id)),
    ])
  } else {
    await recordEdits
  }

  if (scoreQueued) {
    await enqueue({ kind: 'score', applicationId }, () => scoreApplication(applicationId))
  }

  // Teaching the mapping: the next submission reads this answer as this field. The
  // unique key is (client, form, question), so choosing a different answer later
  // simply replaces it; there is nothing to unlearn.
  const answered = changes.filter((c) => c.sourceKey !== undefined)
  if (ingest && params.remember && params.method !== 'applied') {
    for (const c of answered) {
      await db
        .insert(fieldMappings)
        .values({
          clientId: ingest.clientId,
          sourceKey: c.sourceKey!,
          canonicalField: c.field,
          formType: 'application',
          addedBy: actor.id,
        })
        .onConflictDoUpdate({
          target: [fieldMappings.clientId, fieldMappings.formType, fieldMappings.sourceKey],
          set: { canonicalField: c.field, addedBy: actor.id },
        })
    }
  }

  let appliedToOthers = 0
  if (ingest && params.applyToOthers && params.method !== 'applied') {
    const messages: PipelineMessage[] = []
    for (const c of answered) {
      const others = await othersMissing({
        clientId: ingest.clientId,
        excludeApplicationId: applicationId,
        field: c.field,
        sourceKey: c.sourceKey!,
      })
      for (const id of others.readable) {
        messages.push({
          kind: 'apply_answer',
          applicationId: id,
          field: c.field,
          sourceKey: c.sourceKey!,
          editedBy: actor.id,
        })
      }
    }
    appliedToOthers = messages.length
    await enqueueMany(messages, (m) =>
      m.kind === 'apply_answer' ? applyAnswer(m) : Promise.resolve(),
    )
  }

  if (params.method !== 'applied') {
    await recordAudit({
      actorUserId: actor.id,
      action: 'application_edited',
      applicationId,
      metadata: {
        fields: rows.map((r) => r.field),
        // Bank details are named, never quoted: the audit feed is read by roles that
        // cannot see them.
        ...(rows.some((r) => r.field.startsWith('bank')) ? { bankDetails: true } : {}),
      },
    })
  }

  return { rerun, scoreQueued, scoreKept: keep, appliedToOthers }
}

function editableFieldLabelSafe(key: string): string {
  return isEditableField(key) ? editableFieldLabel(key).toLowerCase() : key
}

/**
 * The OTHER applications at this foundation still missing `field` that answered the
 * question `sourceKey`, split by whether their answer can be read without a person
 * (`strictReading`). Awarded applications are never touched.
 */
export async function othersMissing(params: {
  clientId: string
  excludeApplicationId: string
  field: EditableField
  sourceKey: string
}): Promise<{ readable: string[]; unreadable: number }> {
  const column = applications[params.field]
  const rows = await getDb()
    .select({ id: applications.id, payload: applicationIngests.rawPayload })
    .from(applications)
    .innerJoin(applicationIngests, eq(applicationIngests.applicationId, applications.id))
    .innerJoin(roundProgrammes, eq(applications.roundProgrammeId, roundProgrammes.id))
    .innerJoin(programmes, eq(roundProgrammes.programmeId, programmes.id))
    .where(
      and(
        eq(programmes.clientId, params.clientId),
        ne(applications.id, params.excludeApplicationId),
        ne(applications.status, 'awarded'),
        isNull(column),
        sql`${applicationIngests.rawPayload} ? ${params.sourceKey}`,
      ),
    )
    .limit(200)
  const readable: string[] = []
  let unreadable = 0
  for (const r of rows) {
    if (strictReading(params.field, r.payload[params.sourceKey]) !== null) readable.push(r.id)
    else if (toStringValue(r.payload[params.sourceKey])) unreadable++
  }
  return { readable, unreadable }
}

/**
 * The queue handler for `apply_answer`: fill one application in from its own answer.
 * Idempotent: a field filled in meanwhile (by a person, or an earlier delivery of this
 * message) is left alone, and an answer only a person can read is skipped.
 */
export async function applyAnswer(message: {
  applicationId: string
  field: string
  sourceKey: string
  editedBy: string
}): Promise<{ applied: boolean; reason?: string }> {
  if (!isEditableField(message.field)) return { applied: false, reason: 'not_editable' }
  const field = message.field
  const app = await getDb().query.applications.findFirst({
    where: eq(applications.id, message.applicationId),
  })
  if (!app) return { applied: false, reason: 'not_found' }
  if (app.status === 'awarded') return { applied: false, reason: 'awarded' }
  if (app[field] != null) return { applied: false, reason: 'already_filled' }
  const ingest = await getDb().query.applicationIngests.findFirst({
    where: eq(applicationIngests.applicationId, message.applicationId),
    columns: { rawPayload: true },
  })
  const reading = ingest ? strictReading(field, ingest.rawPayload[message.sourceKey]) : null
  if (reading === null) return { applied: false, reason: 'needs_a_person' }
  try {
    await editApplication({
      applicationId: message.applicationId,
      changes: [{ field, value: reading, sourceKey: message.sourceKey }],
      actor: { id: message.editedBy },
      method: 'applied',
    })
  } catch (err) {
    // A conflict (the answer already feeds another field, a value the schema refuses)
    // will refuse again on every retry: report it as not applied rather than throw.
    return { applied: false, reason: err instanceof Error ? err.message : 'refused' }
  }
  return { applied: true }
}

/**
 * Replace an application's budget lines. The applicant's breakdown is often missing,
 * mangled by a form (one text box of "Staff 12k, venue 3k…") or out of date by the time
 * anyone reads it, and the person reading it can usually set it straight.
 *
 * The lines are the whole list, not a patch, as the round dialog's programme array is.
 * Empty clears the breakdown. Each line's `details` (extra columns the foundation's form
 * captured) travel with it untouched. The submission as received is untouched as ever:
 * the edit row keeps the lines as they were, and View Submission shows those.
 */
export async function setBudgetLines(params: {
  applicationId: string
  lines: NonNullable<CreateApplicationInput['budgetBreakdown']>
  actor: Actor
}): Promise<EditResult> {
  const editedAt = new Date() // see `editApplication`
  const { app } = await loadForEdit(params.applicationId)
  const before = app.budgetBreakdown ?? null
  const input = {
    ...canonicalFromApplication(app),
    budgetBreakdown: params.lines.length > 0 ? params.lines : undefined,
  }
  const parsed = CreateApplicationSchema.safeParse(input)
  if (!parsed.success) {
    throw conflict(`Budget: ${parsed.error.issues[0]!.message}`)
  }
  if (JSON.stringify(before ?? []) === JSON.stringify(params.lines)) {
    return { rerun: [], scoreQueued: false, scoreKept: false, appliedToOthers: 0 }
  }

  const roundProgramme = await fetchRoundProgrammeForApplication(app.roundProgrammeId)
  if (!roundProgramme) throw notFoundError()
  const firstAssessment = app.custodianScoreStatus === 'waiting'
  const { rerun, scoreQueued, scoreInputsChanged } = await updateApplicationFromCanonical(
    roundProgramme,
    params.applicationId,
    parsed.data,
    { score: firstAssessment ? 'queued' : 'keep' },
  )
  await getDb()
    .insert(applicationEdits)
    .values({
      applicationId: params.applicationId,
      field: 'budgetBreakdown',
      method: 'typed',
      previousValue: before && before.length > 0 ? JSON.stringify(before) : null,
      newValue: params.lines.length > 0 ? JSON.stringify(params.lines) : null,
      editedBy: params.actor.id,
      createdAt: editedAt,
    })
  if (scoreQueued) {
    const applicationId = params.applicationId
    await enqueue({ kind: 'score', applicationId }, () => scoreApplication(applicationId))
  }
  await recordAudit({
    actorUserId: params.actor.id,
    action: 'application_edited',
    applicationId: params.applicationId,
    metadata: { fields: ['budgetBreakdown'] },
  })
  return {
    rerun,
    scoreQueued,
    scoreKept: !scoreQueued && scoreInputsChanged && app.amountRequested !== null,
    appliedToOthers: 0,
  }
}

/**
 * Choose an application's themes by hand. The themes must come from its programme's
 * list (the same limit the model works to), and once chosen a re-score leaves them be.
 */
export async function setApplicationThemes(params: {
  applicationId: string
  themes: string[]
  actor: Actor
}): Promise<{ themes: string[] }> {
  const editedAt = new Date() // see `editApplication`
  const { app } = await loadForEdit(params.applicationId)
  const rp = await getDb().query.roundProgrammes.findFirst({
    where: eq(roundProgrammes.id, app.roundProgrammeId),
    with: { programme: { columns: { tags: true } } },
  })
  const allowed = new Set(rp?.programme.tags ?? [])
  const themes = [...new Set(params.themes.map((t) => t.trim()).filter(Boolean))]
  if (themes.length === 0) throw conflict('Choose at least one theme.')
  const stray = themes.find((t) => !allowed.has(t))
  if (stray) throw conflict(`"${stray}" is not one of this programme's themes.`)
  // In the programme's own order, so the pills read the same way everywhere.
  const ordered = (rp?.programme.tags ?? []).filter((t) => themes.includes(t))

  const db = getDb()
  await db.batch([
    db
      .update(applications)
      .set({ themes: ordered, themesSetBy: params.actor.id, themesSetAt: new Date() })
      .where(eq(applications.id, params.applicationId)),
    db.insert(applicationEdits).values({
      applicationId: params.applicationId,
      field: 'themes',
      method: 'themes',
      previousValue: app.themes ? JSON.stringify(app.themes) : null,
      newValue: JSON.stringify(ordered),
      editedBy: params.actor.id,
      createdAt: editedAt,
    }),
  ])
  await recordAudit({
    actorUserId: params.actor.id,
    action: 'application_edited',
    applicationId: params.applicationId,
    metadata: { fields: ['themes'] },
  })
  return { themes: ordered }
}

/**
 * Re-run the assessment on purpose. The edit path leaves it alone once a decision is
 * under way; this is how somebody asks for it anyway, knowing the board may have read
 * the old one.
 */
/** Re-runs allowed per application per day: enough to fix, re-run, spot one more thing. */
export const RERUNS_PER_DAY = 5

/** Why a re-run is not on offer. `capped` and `voted` are SHOWN (a disabled button saying why,
 *  after an edit); the rest hide the button, as there is nothing to say about them there. */
export type RerunBlocker = {
  code: 'unavailable' | 'voted' | 'unchanged' | 'capped'
  message: string
}

/**
 * Why a re-run is not on offer right now, or null when it is. One statement of the rule
 * for the button (`getApplication`) and the boundary (`rescoreApplication`).
 *
 *   - Only after an edit to something the assessment reads, made since it last ran (or
 *     after a failed run). A re-run of an unchanged application buys the same answer.
 *   - Never once a trustee has voted: the vote was cast on that assessment, and one
 *     that changes under a vote reads as moving the goalposts. Shortlisted or declined
 *     without votes is still fine; nobody has decided anything on the strength of it.
 *   - At most RERUNS_PER_DAY a day, because each is a paid model call.
 */
export async function rerunBlocker(applicationId: string): Promise<RerunBlocker | null> {
  const db = getDb()
  const app = await db.query.applications.findFirst({
    where: eq(applications.id, applicationId),
    columns: {
      amountRequested: true,
      status: true,
      custodianScoreStatus: true,
      custodianScoredAt: true,
    },
    with: { award: { columns: { id: true } } },
  })
  if (!app) return { code: 'unavailable', message: 'Not found.' }
  if (app.award) return { code: 'unavailable', message: 'This application has been awarded.' }
  if (app.amountRequested === null)
    return { code: 'unavailable', message: 'Fill in the amount requested first.' }
  if (app.custodianScoreStatus === 'queued')
    return { code: 'unavailable', message: 'The assessment is already running.' }
  const [votes, changed, recent] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(applicationVotes)
      .where(eq(applicationVotes.applicationId, applicationId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(applicationEdits)
      .where(
        and(
          eq(applicationEdits.applicationId, applicationId),
          // What the assessment never reads: the bank details, the email, the themes.
          sql`${applicationEdits.field} not like 'bank%'`,
          sql`${applicationEdits.field} not in ('applicantEmail', 'themes')`,
          // Compared IN the database, column against column. Passing the scored-at time in
          // as a parameter round-trips it through a JS Date, which the driver serialised
          // in the machine's local zone: on a laptop in British Summer Time every edit
          // made within the hour after an assessment read as older than it, and the
          // button never appeared. Workers run in UTC, which would only have hidden it.
          sql`${applicationEdits.createdAt} > coalesce(
            (select ${applications.custodianScoredAt} from ${applications}
              where ${applications.id} = ${applicationId}),
            '-infinity'::timestamp)`,
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.applicationId, applicationId),
          eq(auditLog.action, 'assessment_rerun'),
          sql`${auditLog.createdAt} > now() - interval '1 day'`,
        ),
      ),
  ])
  // `unchanged` is checked FIRST so that `voted` only ever means "you edited, and it
  // still cannot be re-run": that one is shown (a disabled button saying why), and shown
  // on every voted application nobody has touched it would be noise.
  if (app.custodianScoreStatus !== 'error' && (changed[0]?.n ?? 0) === 0) {
    return {
      code: 'unchanged',
      message: 'Nothing the assessment reads has changed since it last ran.',
    }
  }
  if ((votes[0]?.n ?? 0) > 0) {
    return {
      code: 'voted',
      message:
        'Trustees have voted on this assessment, so it stays as they saw it. Your changes are saved; the assessment is not re-run.',
    }
  }
  if ((recent[0]?.n ?? 0) >= RERUNS_PER_DAY) {
    return {
      code: 'capped',
      message: `The assessment has been re-run ${RERUNS_PER_DAY} times in the last 24 hours, the most allowed. It can be re-run again tomorrow.`,
    }
  }
  return null
}

/** Re-run the assessment because somebody asked, after editing. See `rerunBlocker`. */
export async function rescoreApplication(applicationId: string, actor: Actor): Promise<void> {
  const blocker = await rerunBlocker(applicationId)
  if (blocker) throw conflict(blocker.message)
  await getDb()
    .update(applications)
    .set({ custodianScoreStatus: 'queued' })
    .where(eq(applications.id, applicationId))
  await recordAudit({ actorUserId: actor.id, action: 'assessment_rerun', applicationId })
  await enqueue({ kind: 'score', applicationId }, () => scoreApplication(applicationId))
}
