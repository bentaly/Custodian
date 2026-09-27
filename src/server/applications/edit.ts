// ─── Editing an application: the IO half ─────────────────────────────────────
//
// See `lib/applicationEdit.ts` for what may be edited and why. This is the write: it
// changes the application ROW (the truth), keeps the ingest's mapping in step so the
// admin app and a later re-confirm agree with it, records who changed what in
// `application_edits`, and re-derives whatever read the changed fields through
// `updateApplicationFromCanonical`, the same engine the admin app's Confirm uses.
//
// The assessment is the one derived feature with a policy of its own. Before anyone
// has decided anything it is re-run (queued, so the person saving is not kept waiting
// a minute); once the application has been shortlisted, declined or voted on it is
// left alone, because a score that moves under a board that has started deciding reads
// as moving the goalposts. The screen offers a deliberate re-score instead.

import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { getDb } from '../db'
import {
  applicationEdits,
  applicationIngests,
  applicationVotes,
  applications,
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
import { CreateApplicationSchema } from '../../lib/validators/application'
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

async function loadForEdit(applicationId: string) {
  const app = await getDb().query.applications.findFirst({
    where: eq(applications.id, applicationId),
    with: { award: { columns: { id: true } } },
  })
  if (!app) throw notFoundError()
  // The line is money, as it is for the admin app's re-confirm: once a grant exists
  // the award letter has been written from these figures.
  if (app.award || app.status === 'awarded') {
    throw conflict('This application has been awarded, so its details can no longer be edited.')
  }
  const ingest = await getDb().query.applicationIngests.findFirst({
    where: eq(applicationIngests.applicationId, applicationId),
  })
  return { app, ingest: ingest ?? null }
}

/** Has anyone started deciding? Then the assessment stays as the board saw it. */
async function decisionUnderWay(app: { id: string; status: string }): Promise<boolean> {
  if (app.status !== 'for_review') return true
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(applicationVotes)
    .where(eq(applicationVotes.applicationId, app.id))
  return (row?.n ?? 0) > 0
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

  const keep = await decisionUnderWay(app)
  const { rerun, scoreQueued } = await updateApplicationFromCanonical(
    roundProgramme,
    applicationId,
    parsed.data,
    { score: keep ? 'keep' : 'queued' },
  )

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
 * Choose an application's themes by hand. The themes must come from its programme's
 * list (the same limit the model works to), and once chosen a re-score leaves them be.
 */
export async function setApplicationThemes(params: {
  applicationId: string
  themes: string[]
  actor: Actor
}): Promise<{ themes: string[] }> {
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
export async function rescoreApplication(applicationId: string): Promise<void> {
  const app = await getDb().query.applications.findFirst({
    where: eq(applications.id, applicationId),
    columns: { amountRequested: true, status: true },
    with: { award: { columns: { id: true } } },
  })
  if (!app) throw notFoundError()
  if (app.award) throw conflict('This application has been awarded.')
  if (app.amountRequested === null) {
    throw conflict('Fill in the amount requested first. The assessment is judged on it.')
  }
  await getDb()
    .update(applications)
    .set({ custodianScoreStatus: 'queued' })
    .where(eq(applications.id, applicationId))
  await enqueue({ kind: 'score', applicationId }, () => scoreApplication(applicationId))
}
