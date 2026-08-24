// ─── Application queue ───────────────────────────────────────────────────────
//
// Where a submission goes when the pipeline could not finish it. The old version
// showed a status word, a grid of dropdowns and four unlabelled buttons, and left
// the operator to infer from that what had gone wrong — which was impossible for
// validation failures, since a row whose amount reads "£15,000 (approx)" has a
// mapping grid indistinguishable from one that is ready to promote.
//
// So every card now leads with WHY it is held (from the server's diagnosis), the
// mapping grid highlights the fields that diagnosis names, and every action states
// what it will do before you press it.
//
// The old separate "Out of round" tab is folded in as a filter: it was the same
// table under a different query (`needs_review` with a null roundProgrammeId), and
// splitting it across two screens meant a submission could be held for BOTH reasons
// and appear complete on whichever screen you happened to open. Its edit-and-resend
// editor survives as an action on any card.

import { useEffect, useMemo, useState } from 'react'
import type { QueueFocus } from './App'
import {
  adminDelete,
  adminGet,
  adminPost,
  autoMappingNote,
  blockedFieldKeys,
  externalIdOf,
  getApplyApiKey,
  resolvedValue,
  PROVIDED,
  submitWithApiKey,
  timeAgo,
  useCanonicalFields,
  type CanonicalField,
  type IngestRow,
} from './api'
import { useQueues } from './queues'
import {
  Action,
  BlockerPanel,
  Button,
  Callout,
  Card,
  EmptyState,
  Loading,
  Page,
  PayloadViewer,
  SectionHeading,
  StatusPill,
} from './ui'

export function ReviewQueue({
  focus,
  onFocusChange,
}: {
  focus: QueueFocus
  onFocusChange: (f: QueueFocus) => void
}) {
  const { buckets, snapshot, loading, error, reload } = useQueues()
  const canonicalFields = useCanonicalFields()

  // `complete` rows are history and are not in the shared active snapshot — fetched
  // only when someone asks to look at them.
  const [done, setDone] = useState<IngestRow[] | null>(null)
  const [doneError, setDoneError] = useState<string | null>(null)
  useEffect(() => {
    if (focus !== 'done' || done) return
    adminGet<IngestRow[]>('/api/admin/ingests?status=complete')
      .then(setDone)
      .catch((e: Error) => setDoneError(e.message))
  }, [focus, done])

  const active = snapshot?.applications ?? []
  const filters: Array<{ key: QueueFocus; label: string; rows: IngestRow[]; blurb: string }> = [
    {
      key: 'held',
      label: 'Needs mapping',
      rows: buckets.needsMapping,
      blurb:
        'A required field could not be matched, both register numbers are missing, or a mapped value fails validation. Fix the mapping below and resolve.',
    },
    {
      key: 'out-of-round',
      label: 'Out of round',
      rows: buckets.outOfRound,
      blurb:
        'These name a programme that does not exist for the foundation, or one whose round is not open. The mapping grid cannot fix that — correct the name with Edit & resend, or open the round and reprocess.',
    },
    {
      key: 'stalled',
      label: 'Stalled',
      rows: buckets.stalled,
      blurb:
        'The background pipeline crashed on these. The payload is intact and nothing was created — Reprocess runs it again, inline, so you see what happens.',
    },
    {
      key: 'confirm',
      label: 'To confirm',
      rows: buckets.awaitingConfirmation,
      blurb:
        'The application already exists — the AI was confident enough to create it. Agree the mapping (and teach it to the lookup table) to close these off.',
    },
    {
      key: 'processing',
      label: 'Processing',
      rows: buckets.processing,
      blurb: 'Arrived moments ago and still moving through the pipeline. Nothing to do.',
    },
    {
      key: 'all',
      label: 'Everything active',
      rows: active,
      blurb: 'Every submission not yet finished, whatever the reason.',
    },
    {
      key: 'done',
      label: 'Done',
      rows: done ?? [],
      blurb: 'Mapped, created and confirmed. Kept for audit; the mapping is read-only.',
    },
  ]

  // A focus arriving from the Overview may not be one this screen offers.
  const current = filters.find((f) => f.key === focus) ?? filters[0]!

  return (
    <Page
      title="Applications"
      intro="Incoming grant applications the pipeline could not file on its own. Each card says why it is here and what will happen if you act on it."
      actions={
        <Button onClick={reload} busy={loading} busyLabel="Refreshing">
          Refresh
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap gap-1.5">
        {filters.map((f) => {
          const selected = f.key === current.key
          const count = f.key === 'done' ? done?.length : f.rows.length
          return (
            <button
              key={f.key}
              onClick={() => onFocusChange(f.key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                selected
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
              }`}
            >
              {f.label}
              {count !== undefined && (
                <span className={selected ? 'ml-1.5 opacity-70' : 'ml-1.5 text-slate-400'}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <p className="mb-5 max-w-3xl text-xs leading-relaxed text-slate-500">{current.blurb}</p>

      {error && (
        <div className="mb-4">
          <Callout tone="danger" title="Could not load the queue">
            {error}
          </Callout>
        </div>
      )}
      {doneError && focus === 'done' && (
        <div className="mb-4">
          <Callout tone="danger" title="Could not load completed submissions">
            {doneError}
          </Callout>
        </div>
      )}

      {loading && !snapshot && <Loading what="Loading submissions" />}
      {focus === 'done' && !done && !doneError && <Loading what="Loading history" />}

      {(focus !== 'done' || done) && current.rows.length === 0 && (
        <EmptyState
          title={`Nothing in ${current.label.toLowerCase()}`}
          detail={
            current.key === 'held' || current.key === 'out-of-round'
              ? 'Nothing is waiting on you in this bucket.'
              : undefined
          }
        />
      )}

      <div className="space-y-3">
        {current.rows.map((row) => (
          <IngestCard
            key={row.id}
            row={row}
            canonicalFields={canonicalFields}
            onChanged={() => {
              setDone(null)
              reload()
            }}
          />
        ))}
      </div>
    </Page>
  )
}

/** "a", "a and b", "a, b and c" — British English, no Oxford comma. */
function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** Render a raw payload value for the reviewer. Structured values (a budget
 *  breakdown's line items) are JSON — `String()` would show "[object Object]". */
function previewValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

function IngestCard({
  row,
  canonicalFields,
  onChanged,
}: {
  row: IngestRow
  canonicalFields: CanonicalField[]
  onChanged: () => void
}) {
  // Nothing here is read-only any more, including a filed submission: a mapping
  // mistake does not stop being a mistake once the row says Done, and the only way to
  // fix one used to be deleting the application and asking the foundation to resubmit.
  // The server refuses if a grant has since been awarded from it.
  const readOnly = false
  const [open, setOpen] = useState(row.status === 'needs_review')
  const [editing, setEditing] = useState(false)
  const payloadKeys = useMemo(() => Object.keys(row.rawPayload), [row.rawPayload])

  // Invert the stored resolved map (sourceKey → canonical) to canonical → sourceKey.
  const resolvedByCanonical = useMemo(() => {
    const m: Record<string, string> = {}
    for (const [src, canon] of Object.entries(row.resolved ?? {})) m[canon] = src
    return m
  }, [row.resolved])

  // Chosen source key per canonical field: stored resolution, else AI proposal. Seeded
  // here and topped up when the canonical registry arrives (it may load after mount).
  const [mapping, setMapping] = useState<Record<string, string>>({})
  // Values typed by hand rather than taken from an incoming field. Seeded from the row
  // so re-opening a resolved one shows what was supplied — and, more importantly, so
  // pressing Confirm sends it back: a confirm rewrites the whole application, and a
  // typed value the grid had forgotten would be blanked.
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => {
    const provided = row.providedValues ?? {}
    setMapping((prev) => {
      let changed = false
      const next = { ...prev }
      for (const f of canonicalFields) {
        if (next[f.key] === undefined) {
          next[f.key] = provided[f.key]
            ? PROVIDED
            : (resolvedByCanonical[f.key] ?? row.proposed?.[f.key]?.sourceKey ?? '')
          changed = true
        }
      }
      return changed ? next : prev
    })
    setValues((prev) => {
      let changed = false
      const next = { ...prev }
      for (const [k, v] of Object.entries(provided)) {
        if (next[k] === undefined) {
          next[k] = v
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [canonicalFields, resolvedByCanonical, row.proposed, row.providedValues])

  const [addToLookup, setAddToLookup] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [reprocessing, setReprocessing] = useState(false)

  // Outcomes are kept per action, not per card: the message has to appear beside the
  // button that caused it, or a failure at the bottom of a long card announces itself
  // somewhere off-screen and the button just looks inert.
  const [resolveMsg, setResolveMsg] = useState<{ error?: string; notice?: string } | null>(null)
  const [reprocessMsg, setReprocessMsg] = useState<{ error?: string; notice?: string } | null>(null)
  const [deleteMsg, setDeleteMsg] = useState<{ error?: string } | null>(null)

  // A field whose chosen source key already maps itself needs no lookup — see
  // `autoMappingNote`. Excluded from "tick all" too, or the control could never reach
  // "all ticked" and would keep offering to write rows that change nothing.
  const autoFor = (sourceKey: string) => (sourceKey ? row.autoMappings?.[sourceKey] : undefined)
  const needsLookup = (canonicalKey: string) => {
    const chosen = mapping[canonicalKey]
    // A lookup maps an incoming FIELD NAME to a canonical field. A typed value has no
    // field name, so there is nothing to teach — and a row written for the sentinel
    // would put a phantom field in the foundation's table.
    if (!chosen || chosen === PROVIDED) return false
    return autoFor(chosen)?.canonicalField !== canonicalKey
  }
  const mappedKeys = canonicalFields.map((f) => f.key).filter((k) => needsLookup(k))
  const allTicked = mappedKeys.length > 0 && mappedKeys.every((k) => addToLookup[k])
  function toggleAllLookups() {
    setAddToLookup(Object.fromEntries(mappedKeys.map((k) => [k, !allTicked])))
  }

  // One-of groups (charity number / company number) with nothing chosen. The server
  // refuses these; surfacing it here is about saying so before the click rather than
  // after — a reviewer who leaves both blank is usually looking at one ambiguous
  // label ("Organisation registration number") and needs to pick a register.
  const unmetOneOf = useMemo(() => {
    const groups = new Map<number, CanonicalField[]>()
    for (const f of canonicalFields) {
      if (f.oneOfGroup == null) continue
      const list = groups.get(f.oneOfGroup) ?? []
      list.push(f)
      groups.set(f.oneOfGroup, list)
    }
    return [...groups.values()].filter((g) => !g.some((f) => mapping[f.key]))
  }, [canonicalFields, mapping])

  // Fields the server's diagnosis is complaining about, so the grid can point at them.
  const flagged = useMemo(() => blockedFieldKeys(row.blockers), [row.blockers])
  const fieldMessages = useMemo(() => {
    const m: Record<string, string> = {}
    for (const b of row.blockers)
      for (const f of b.fields ?? []) if (f.message) m[f.key] = f.message
    return m
  }, [row.blockers])

  const organisation = resolvedValue(row, 'organisationName')
  const stalled = row.blockers.some((b) => b.code === 'pipeline_stalled')
  const headline = row.blockers.find((b) => b.severity === 'blocking') ?? row.blockers[0]

  async function remove() {
    const msg =
      row.status === 'received'
        ? 'This row may still be processing — deleting now can leave an orphaned application. Delete anyway?'
        : row.applicationId
          ? 'Delete this ingest AND its application (including any comments and votes)?'
          : 'Delete this ingest?'
    if (!window.confirm(msg)) return
    setDeleting(true)
    setDeleteMsg(null)
    try {
      await adminDelete(`/api/admin/ingests/${row.id}`)
      onChanged()
    } catch (e) {
      setDeleteMsg({ error: (e as Error).message })
    } finally {
      setDeleting(false)
    }
  }

  // Re-run the pipeline on a row whose background run never finished. Runs inline on
  // the server, so the outcome is reported here rather than needing another refresh.
  async function reprocess() {
    setReprocessing(true)
    setReprocessMsg(null)
    try {
      const result = await adminPost<{ status: string; applicationId: string | null }>(
        `/api/admin/ingests/${row.id}/reprocess`,
        {},
      )
      setReprocessMsg({
        notice:
          result.status === 'needs_review'
            ? 'Reprocessed — it still cannot be filed automatically. The reasons are above; resolve it by hand.'
            : `Reprocessed — promoted to an application (${result.status}).`,
      })
      onChanged()
    } catch (e) {
      setReprocessMsg({ error: (e as Error).message })
    } finally {
      setReprocessing(false)
    }
  }

  async function resolve() {
    setSaving(true)
    setResolveMsg(null)
    try {
      const cleanMapping: Record<string, string> = {}
      const cleanValues: Record<string, string> = {}
      for (const [k, v] of Object.entries(mapping)) {
        // The sentinel is not a source key, so it never goes in `mapping` — the typed
        // value travels in `values` instead.
        if (v === PROVIDED) {
          const typed = values[k]?.trim()
          if (typed) cleanValues[k] = typed
        } else if (v) {
          cleanMapping[k] = v
        }
      }
      const result = await adminPost<{ applicationId: string; updated: boolean; rerun: string[] }>(
        `/api/admin/ingests/${row.id}/resolve`,
        {
          mapping: cleanMapping,
          values: cleanValues,
          addToLookup: Object.keys(addToLookup).filter((k) => addToLookup[k] && needsLookup(k)),
        },
      )
      // Say what a confirm actually did to the application. "Confirmed" alone left the
      // reviewer unable to tell a correction that landed from one that went nowhere.
      if (row.applicationId) {
        setResolveMsg({
          notice: result.updated
            ? `Mapping corrected and applied to the application${
                result.rerun.length ? `; re-ran ${formatList(result.rerun)}.` : '.'
              }`
            : 'Saved. The mapping was unchanged, so the application is as it was.',
        })
      }
      onChanged()
    } catch (e) {
      const fields = (e as { fields?: Array<{ field: string; message: string }> }).fields
      setResolveMsg({
        error: fields?.length
          ? `${(e as Error).message}: ${fields.map((f) => `${f.field} (${f.message})`).join(', ')}`
          : (e as Error).message,
      })
    } finally {
      setSaving(false)
    }
  }

  // Everything except a row still in the pipeline can be resolved or re-resolved.
  const canResolve = row.status !== 'received'
  const isRefiling = row.status === 'complete'

  return (
    <Card>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">
            {organisation ?? '(organisation not mapped)'}
            <span className="ml-2 font-normal text-slate-400">{row.client.name}</span>
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            {externalIdOf(row) ?? 'no reference'} · {timeAgo(row.createdAt)} · {payloadKeys.length}{' '}
            fields
          </p>
          {headline && !open && (
            <p
              className={`mt-1.5 truncate text-xs font-medium ${
                headline.severity === 'blocking' ? 'text-amber-700' : 'text-slate-500'
              }`}
            >
              {headline.title}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill status={row.status} stalled={stalled} />
          <span className="text-xs text-slate-300">{open ? '▾' : '▸'}</span>
        </div>
      </button>

      {open && (
        <div className="space-y-5 border-t border-slate-100 px-4 py-4">
          <BlockerPanel blockers={row.blockers} />

          {/* The mapping grid is meaningless for a row that never got mapped. */}
          {row.status !== 'received' && (
            <div>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <SectionHeading>Field mapping</SectionHeading>
                {!readOnly && mappedKeys.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={toggleAllLookups}>
                    {allTicked ? 'Untick all lookups' : 'Tick all lookups'}
                  </Button>
                )}
              </div>
              <p className="mb-3 text-xs leading-relaxed text-slate-500">
                Left: the canonical field the app stores. Middle: which of this submission's
                incoming fields holds it — or <strong>type a value</strong>, for an answer that
                cannot be used as it stands (a paragraph where the app needs a place name). Ticking{' '}
                <strong>lookup</strong> teaches this foundation's table, so the same incoming field
                name maps itself next time — the only thing that stops a queue like this filling up
                again. A typed value teaches nothing: it belongs to this submission, not to a field
                name.
              </p>

              <div className="space-y-1.5">
                {canonicalFields.map((f) => {
                  const chosen = mapping[f.key] ?? ''
                  // Only when the auto-mapping is for THIS field: the same source key
                  // pointed at a different canonical field is a reviewer overriding it,
                  // which is precisely a mapping worth learning.
                  const auto = autoFor(chosen)
                  const autoNote = auto?.canonicalField === f.key ? autoMappingNote(auto.via) : null
                  const proposal = row.proposed?.[f.key]
                  const isProvided = chosen === PROVIDED
                  const preview = chosen && !isProvided ? previewValue(row.rawPayload[chosen]) : ''
                  const isFlagged = flagged.has(f.key)
                  const message = fieldMessages[f.key]
                  return (
                    <div
                      key={f.key}
                      className={`grid grid-cols-12 items-center gap-2 rounded-md px-1.5 py-1 ${
                        isFlagged ? 'bg-amber-50/70 ring-1 ring-amber-200' : ''
                      }`}
                    >
                      <label className="col-span-3 text-xs font-medium text-slate-700">
                        {f.label}
                        {f.required && (
                          <span
                            className="ml-0.5 text-rose-500"
                            title="Required — blocks promotion"
                          >
                            *
                          </span>
                        )}
                        {f.oneOfGroup != null && (
                          <span
                            className={`ml-1 rounded-sm px-1 py-0.5 text-[10px] ${
                              unmetOneOf.some((g) => g.some((x) => x.key === f.key))
                                ? 'bg-rose-50 text-rose-600'
                                : 'bg-slate-100 text-slate-500'
                            }`}
                            title="One of this pair must be mapped — without either, due diligence can never run."
                          >
                            1 of 2
                          </span>
                        )}
                        {message && (
                          <span className="mt-0.5 block font-normal text-[10px] text-amber-700">
                            {message}
                          </span>
                        )}
                      </label>
                      <select
                        disabled={readOnly}
                        value={chosen}
                        onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                        className="col-span-4 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:bg-slate-50 disabled:text-slate-500"
                      >
                        <option value="">— none —</option>
                        {/*
                          The escape hatch for an answer that cannot be used as it stands:
                          a prose reply to a question the app needs as a place name, a
                          number buried in a sentence. Without it the only way to supply a
                          value was to re-post the whole submission through /api/apply.
                        */}
                        <option value={PROVIDED}>— type a value —</option>
                        {payloadKeys.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                      {isProvided ? (
                        <input
                          disabled={readOnly}
                          value={values[f.key] ?? ''}
                          onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                          placeholder="Type the value"
                          className="col-span-3 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs disabled:bg-slate-50 disabled:text-slate-500"
                        />
                      ) : (
                        <span
                          className="col-span-3 truncate text-xs text-slate-500"
                          title={preview}
                        >
                          {preview}
                        </span>
                      )}
                      <div className="col-span-2 flex items-center justify-end gap-1.5 text-xs">
                        {proposal?.sourceKey && (
                          <span
                            className="rounded-sm bg-sky-50 px-1.5 py-0.5 text-sky-700"
                            title={`AI suggested “${proposal.sourceKey}” with ${Math.round(proposal.confidence * 100)}% confidence`}
                          >
                            AI {Math.round(proposal.confidence * 100)}%
                          </span>
                        )}
                        {chosen && autoNote && (
                          <span
                            className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-slate-500"
                            title={autoNote.title}
                          >
                            {autoNote.label}
                          </span>
                        )}
                        {!readOnly && chosen && !autoNote && (
                          <label
                            className="flex cursor-pointer items-center gap-1 text-slate-500"
                            title="Remember this incoming field name for this foundation"
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(addToLookup[f.key])}
                              onChange={(e) =>
                                setAddToLookup((s) => ({ ...s, [f.key]: e.target.checked }))
                              }
                            />
                            lookup
                          </label>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <PayloadViewer payload={row.rawPayload} />

          {editing && (
            <ResendEditor
              row={row}
              onCancel={() => setEditing(false)}
              onDone={() => {
                setEditing(false)
                onChanged()
              }}
            />
          )}

          {row.applicationId && (
            <Callout tone="info">
              An application already exists for this submission —{' '}
              <span className="font-mono">{row.applicationId}</span>. Resolving confirms the
              mapping; it does not create a second one.
            </Callout>
          )}

          <div className="space-y-2.5 border-t border-slate-100 pt-4">
            <SectionHeading>Actions</SectionHeading>
            {canResolve && (
              <Action
                variant="primary"
                label={
                  isRefiling
                    ? 'Re-apply mapping'
                    : row.applicationId
                      ? 'Confirm mapping'
                      : 'Resolve'
                }
                busy={saving}
                busyLabel={isRefiling ? 'Applying' : row.applicationId ? 'Confirming' : 'Resolving'}
                onClick={resolve}
                error={resolveMsg?.error}
                notice={resolveMsg?.notice}
                description={
                  isRefiling
                    ? 'Corrects an already-filed application: writes the mapping above over it and re-runs due diligence, the score or the deprivation lookup if their inputs changed. Refused once a grant has been awarded from it, since the award letter was written from these figures.'
                    : row.applicationId
                      ? 'Applies any corrections above to the existing application — re-running due diligence, the score or the deprivation lookup if their inputs changed — saves ticked lookups, and marks this done. No second application is created.'
                      : 'Creates the application from the mapping above, runs due diligence and the Custodian score, and saves any ticked lookups. It becomes visible to the foundation immediately.'
                }
              />
            )}
            <Action
              label="Reprocess"
              busy={reprocessing}
              busyLabel="Reprocessing"
              onClick={reprocess}
              error={reprocessMsg?.error}
              notice={reprocessMsg?.notice}
              disabled={row.status !== 'received'}
              description={
                row.status === 'received'
                  ? 'Runs the whole pipeline again from the raw payload, inline, and reports the outcome here. Use after fixing something outside this app — reopening a round, adding a lookup, restoring an API key.'
                  : 'Only available while a submission is still stuck at “received”. This one has already been through the pipeline — to re-apply a corrected mapping use Confirm, or Edit & resend to put fresh data through.'
              }
            />
            <Action
              label={editing ? 'Close editor' : 'Edit & resend'}
              onClick={() => setEditing((e) => !e)}
              description="Correct the raw data — usually a programme name that matched nothing — and post it back through /api/apply as a fresh submission. This row is deleted once the new one is accepted."
            />
            <Action
              variant="danger"
              label="Delete"
              busy={deleting}
              busyLabel="Deleting"
              onClick={remove}
              error={deleteMsg?.error}
              description={
                row.applicationId
                  ? 'Removes this row and its application, with any comments and votes. Refused if a grant has been awarded against it.'
                  : 'Removes this row for good. The submission is not recoverable — the foundation would have to send it again.'
              }
            />
          </div>
        </div>
      )}
    </Card>
  )
}

/**
 * Edit the raw payload and post it back through the public endpoint. Lifted out of
 * the old Out-of-round screen, where it was the only way to fix a mis-named
 * programme — and where it posted to /api/apply with no Authorization header, so it
 * had returned 401 for every operator since API-key auth landed.
 */
function ResendEditor({
  row,
  onCancel,
  onDone,
}: {
  row: IngestRow
  onCancel: () => void
  onDone: () => void
}) {
  const [fields, setFields] = useState(() =>
    Object.entries(row.rawPayload).map(([key, value]) => ({
      key,
      value:
        typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? ''),
    })),
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const update = (i: number, k: 'key' | 'value', val: string) =>
    setFields((f) => f.map((r, idx) => (idx === i ? { ...r, [k]: val } : r)))
  const removeRow = (i: number) => setFields((f) => f.filter((_, idx) => idx !== i))
  const addRow = () => setFields((f) => [...f, { key: '', value: '' }])

  async function resend() {
    setBusy(true)
    setErr(null)
    try {
      const payload = Object.fromEntries(
        fields.filter((f) => f.key.trim()).map((f) => [f.key.trim(), f.value]),
      )
      // The key both authenticates the call and names the client, so a resend without
      // one is a 401 — not a validation error, which is why it used to look like the
      // payload was at fault.
      await submitWithApiKey('/api/apply', payload, getApplyApiKey())
      // The resend created a fresh ingest; drop this stale held one.
      await adminDelete(`/api/admin/ingests/${row.id}`)
      onDone()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
      <div>
        <SectionHeading>Edit & resend</SectionHeading>
        <p className="text-xs leading-relaxed text-slate-500">
          Sent as a brand new submission under the API key set on the Testing screen — which decides
          which foundation it lands under, so make sure it is {row.client.name}'s key.
        </p>
      </div>

      <div className="space-y-1.5">
        {fields.map((f, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={f.key}
              onChange={(e) => update(i, 'key', e.target.value)}
              className="w-1/3 rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs"
            />
            <input
              value={f.value}
              onChange={(e) => update(i, 'value', e.target.value)}
              className="flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
            />
            <Button size="sm" variant="danger" onClick={() => removeRow(i)}>
              ✕
            </Button>
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={addRow}>
          + Add field
        </Button>
      </div>

      {err && <Callout tone="danger">{err}</Callout>}

      <div className="flex gap-2">
        <Button variant="primary" onClick={resend} busy={busy} busyLabel="Resending">
          Resend through the pipeline
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}
