// ─── Report queue ────────────────────────────────────────────────────────────
//
// The application queue's twin for incoming grant reports, with one extra blocker
// applications don't have: no grant to attach to. Auto-linking happens only on an
// exact `externalApplicationId` hit, deliberately — a report on the wrong grant ticks
// the wrong reporting milestone and tells a foundation a grantee has reported when
// they haven't. So "held for a human to pick the grant" is the designed outcome here
// far more often than it is a fault, and the queue says which of the two it is.

import { useEffect, useMemo, useState } from 'react'
import type { QueueFocus } from './App'
import {
  adminDelete,
  adminGet,
  adminPost,
  blockedFieldKeys,
  resolvedValue,
  timeAgo,
  useReportCanonicalFields,
  type CanonicalField,
  type GrantOption,
  type ReportIngestRow,
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

export function ReportQueue({
  focus,
  onFocusChange,
}: {
  focus: QueueFocus
  onFocusChange: (f: QueueFocus) => void
}) {
  const { buckets, snapshot, loading, error, reload } = useQueues()
  const canonicalFields = useReportCanonicalFields()

  const [done, setDone] = useState<ReportIngestRow[] | null>(null)
  const [doneError, setDoneError] = useState<string | null>(null)
  useEffect(() => {
    if (focus !== 'done' || done) return
    adminGet<ReportIngestRow[]>('/api/admin/report-ingests?status=complete')
      .then(setDone)
      .catch((e: Error) => setDoneError(e.message))
  }, [focus, done])

  const filters: Array<{ key: QueueFocus; label: string; rows: ReportIngestRow[]; blurb: string }> =
    [
      {
        key: 'need-grant',
        label: 'Needs a grant',
        rows: buckets.reportsNeedGrant,
        blurb:
          'These mapped fine but could not be linked to a grant automatically. Pick the grant each belongs to — suggestions are ranked, but they are heuristics, so check them.',
      },
      {
        key: 'held',
        label: 'Needs mapping',
        rows: buckets.reportsNeedsMapping,
        blurb: 'Held on their fields rather than on the grant match.',
      },
      {
        key: 'stalled',
        label: 'Stalled',
        rows: buckets.reportsStalled,
        blurb:
          'The background pipeline crashed on these. Unlike applications there is no reprocess endpoint for reports — resolve them by hand below.',
      },
      {
        key: 'confirm',
        label: 'To confirm',
        rows: buckets.reportsAwaitingConfirmation,
        blurb:
          'The submission already exists and its milestone is ticked. Agree the mapping to close these off.',
      },
      {
        key: 'processing',
        label: 'Processing',
        rows: buckets.reportsProcessing,
        blurb: 'Arrived moments ago and still moving through the pipeline. Nothing to do.',
      },
      {
        key: 'all',
        label: 'Everything active',
        rows: snapshot?.reports ?? [],
        blurb: 'Every report not yet finished, whatever the reason.',
      },
      {
        key: 'done',
        label: 'Done',
        rows: done ?? [],
        blurb: 'Linked, analysed and confirmed. Kept for audit; the mapping is read-only.',
      },
    ]

  const current = filters.find((f) => f.key === focus) ?? filters[0]!

  return (
    <Page
      title="Grant reports"
      intro="Reports sent in by grantees. A report only files itself when its application reference matches exactly one grant — everything else waits here."
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
          <Callout tone="danger" title="Could not load completed reports">
            {doneError}
          </Callout>
        </div>
      )}

      {loading && !snapshot && <Loading what="Loading reports" />}
      {focus === 'done' && !done && !doneError && <Loading what="Loading history" />}

      {(focus !== 'done' || done) && current.rows.length === 0 && (
        <EmptyState title={`Nothing in ${current.label.toLowerCase()}`} />
      )}

      <div className="space-y-3">
        {current.rows.map((row) => (
          <ReportCard
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

function previewValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

function ReportCard({
  row,
  canonicalFields,
  onChanged,
}: {
  row: ReportIngestRow
  canonicalFields: CanonicalField[]
  onChanged: () => void
}) {
  const [open, setOpen] = useState(row.status === 'needs_review')
  const payloadKeys = useMemo(() => Object.keys(row.rawPayload), [row.rawPayload])
  const readOnly = row.status === 'complete'

  const resolvedByCanonical = useMemo(() => {
    const m: Record<string, string> = {}
    for (const [src, canon] of Object.entries(row.resolved ?? {})) m[canon] = src
    return m
  }, [row.resolved])

  const [mapping, setMapping] = useState<Record<string, string>>({})
  useEffect(() => {
    setMapping((prev) => {
      let changed = false
      const next = { ...prev }
      for (const f of canonicalFields) {
        if (next[f.key] === undefined) {
          next[f.key] = resolvedByCanonical[f.key] ?? row.proposed?.[f.key]?.sourceKey ?? ''
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [canonicalFields, resolvedByCanonical, row.proposed])

  const [addToLookup, setAddToLookup] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Grant matching: load the client's grants when the card opens (once), pre-selecting
  // the top-ranked candidate. `awardId` is the key the server stores and accepts — it
  // was read as `grantId` here, so no candidate ever matched and no pre-selection ever
  // happened; worse, resolve posted `grantId` too, which ResolveReportSchema ignored,
  // so every attempt came back "Grant not found for this client".
  const [grants, setGrants] = useState<GrantOption[] | null>(null)
  const [awardId, setAwardId] = useState<string>(row.matchCandidates?.[0]?.awardId ?? '')
  const needsMatch = row.status !== 'complete' && !row.reportId
  useEffect(() => {
    if (!open || !needsMatch || grants) return
    adminGet<GrantOption[]>(`/api/admin/awards?clientId=${row.client.id}`)
      .then(setGrants)
      .catch((e: Error) => setErr(e.message))
  }, [open, needsMatch, grants, row.client.id])

  const candidateById = useMemo(() => {
    const m = new Map<string, { score: number; reasons: string[] }>()
    for (const c of row.matchCandidates ?? []) m.set(c.awardId, c)
    return m
  }, [row.matchCandidates])

  // Candidates first (in rank order), then the rest of the client's grants.
  const orderedGrants = useMemo(() => {
    if (!grants) return []
    return [...grants].sort((a, b) => {
      const ca = candidateById.get(a.id)?.score ?? -1
      const cb = candidateById.get(b.id)?.score ?? -1
      return cb - ca
    })
  }, [grants, candidateById])

  const mappedKeys = canonicalFields.map((f) => f.key).filter((k) => mapping[k])
  const allTicked = mappedKeys.length > 0 && mappedKeys.every((k) => addToLookup[k])
  function toggleAllLookups() {
    setAddToLookup(Object.fromEntries(mappedKeys.map((k) => [k, !allTicked])))
  }

  const flagged = useMemo(() => blockedFieldKeys(row.blockers), [row.blockers])
  const fieldMessages = useMemo(() => {
    const m: Record<string, string> = {}
    for (const b of row.blockers) for (const f of b.fields ?? []) if (f.message) m[f.key] = f.message
    return m
  }, [row.blockers])

  const organisation = resolvedValue(row, 'organisationName')
  const stalled = row.blockers.some((b) => b.code === 'pipeline_stalled')
  const headline = row.blockers.find((b) => b.severity === 'blocking') ?? row.blockers[0]

  async function remove() {
    const msg =
      row.status === 'received'
        ? 'This row may still be processing — deleting now can leave an orphaned report. Delete anyway?'
        : row.reportId
          ? 'Delete this report AND its submission (the reporting milestone it ticked will reopen)?'
          : 'Delete this report?'
    if (!window.confirm(msg)) return
    setDeleting(true)
    setErr(null)
    try {
      await adminDelete(`/api/admin/report-ingests/${row.id}`)
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  async function resolve() {
    setSaving(true)
    setErr(null)
    try {
      if (needsMatch && !awardId) throw new Error('Pick the grant this report belongs to')
      const cleanMapping: Record<string, string> = {}
      for (const [k, v] of Object.entries(mapping)) if (v) cleanMapping[k] = v
      await adminPost(`/api/admin/report-ingests/${row.id}/resolve`, {
        mapping: cleanMapping,
        addToLookup: Object.keys(addToLookup).filter((k) => addToLookup[k] && mapping[k]),
        awardId: awardId || row.matchCandidates?.[0]?.awardId,
      })
      onChanged()
    } catch (e) {
      const fields = (e as { fields?: Array<{ field: string; message: string }> }).fields
      setErr(
        fields?.length
          ? `${(e as Error).message}: ${fields.map((f) => `${f.field} (${f.message})`).join(', ')}`
          : (e as Error).message,
      )
    } finally {
      setSaving(false)
    }
  }

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
            {resolvedValue(row, 'externalApplicationId') ?? 'no reference'} ·{' '}
            {timeAgo(row.createdAt)} · {payloadKeys.length} fields
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

          {err && <Callout tone="danger">{err}</Callout>}

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
              <div className="space-y-1.5">
                {canonicalFields.map((f) => {
                  const chosen = mapping[f.key] ?? ''
                  const proposal = row.proposed?.[f.key]
                  const preview = chosen ? previewValue(row.rawPayload[chosen]) : ''
                  const message = fieldMessages[f.key]
                  return (
                    <div
                      key={f.key}
                      className={`grid grid-cols-12 items-center gap-2 rounded-md px-1.5 py-1 ${
                        flagged.has(f.key) ? 'bg-amber-50/70 ring-1 ring-amber-200' : ''
                      }`}
                    >
                      <label className="col-span-3 text-xs font-medium text-slate-700">
                        {f.label}
                        {f.required && <span className="ml-0.5 text-rose-500">*</span>}
                        {message && (
                          <span className="mt-0.5 block text-[10px] font-normal text-amber-700">
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
                        {payloadKeys.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                      <span className="col-span-3 truncate text-xs text-slate-500" title={preview}>
                        {preview}
                      </span>
                      <div className="col-span-2 flex items-center justify-end gap-1.5 text-xs">
                        {proposal?.sourceKey && (
                          <span
                            className="rounded-sm bg-sky-50 px-1.5 py-0.5 text-sky-700"
                            title={`AI suggested “${proposal.sourceKey}”`}
                          >
                            AI {Math.round(proposal.confidence * 100)}%
                          </span>
                        )}
                        {!readOnly && chosen && (
                          <label className="flex cursor-pointer items-center gap-1 text-slate-500">
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

          {needsMatch && (
            <div>
              <SectionHeading
                hint={
                  row.matchCandidates?.length
                    ? 'Ranked suggestions first. They are heuristics — organisation name, amount, dates — so check the one you pick.'
                    : 'No confident suggestions, so every grant this foundation holds is listed.'
                }
              >
                Which grant is this report for?
              </SectionHeading>
              {!grants && <Loading what="Loading grants" />}
              {grants && grants.length === 0 && (
                <Callout tone="warn">
                  This foundation has no grants on record, so there is nothing to attach this report
                  to. It stays held until its grant is created or imported.
                </Callout>
              )}
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {orderedGrants.map((g) => {
                  const cand = candidateById.get(g.id)
                  return (
                    <label
                      key={g.id}
                      className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ${
                        awardId === g.id
                          ? 'border-indigo-400 bg-indigo-50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`grant-${row.id}`}
                        checked={awardId === g.id}
                        onChange={() => setAwardId(g.id)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="font-medium text-slate-800">
                          {g.organisationName ?? '(direct grant)'}
                        </span>{' '}
                        <span className="text-slate-500">
                          £{Number(g.amountAwarded).toLocaleString('en-GB')}
                          {g.programmeName ? ` · ${g.programmeName}` : ''} ·{' '}
                          {new Date(g.decisionAt).toLocaleDateString('en-GB')} · reports{' '}
                          {g.totalMilestones - g.openMilestones}/{g.totalMilestones}
                        </span>
                        {cand && (
                          <span className="ml-1 rounded-sm bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                            {cand.reasons.join(' · ')}
                          </span>
                        )}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          <PayloadViewer payload={row.rawPayload} />

          {row.reportId && (
            <Callout tone="info">
              A report submission already exists — <span className="font-mono">{row.reportId}</span>
              . Confirming the mapping does not create a second one.
            </Callout>
          )}

          <div className="space-y-2.5 border-t border-slate-100 pt-4">
            <SectionHeading>Actions</SectionHeading>
            {!readOnly && (
              <Action
                variant="primary"
                label={row.reportId ? 'Confirm mapping' : 'Resolve'}
                busy={saving}
                busyLabel={row.reportId ? 'Confirming' : 'Resolving'}
                onClick={resolve}
                description={
                  row.reportId
                    ? 'Saves any ticked lookups and marks this done.'
                    : 'Creates the report submission against the grant chosen above, ticks its earliest open reporting milestone, and runs the AI analysis. Visible to the foundation immediately.'
                }
              />
            )}
            <Action
              variant="danger"
              label="Delete"
              busy={deleting}
              busyLabel="Deleting"
              onClick={remove}
              description={
                row.reportId
                  ? 'Removes this row and its submission. The reporting milestone it ticked reopens.'
                  : 'Removes this row for good. The grantee would have to send the report again.'
              }
            />
          </div>
        </div>
      )}
    </Card>
  )
}
