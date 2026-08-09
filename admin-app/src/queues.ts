// ─── Live queue state ────────────────────────────────────────────────────────
//
// One fetch of everything still in flight, shared by the sidebar counts and the
// Overview screen. Held in a module-level store rather than fetched per component
// so the badge in the nav and the number on the card can never disagree — and so
// resolving something in a queue updates the count beside it without a reload.
//
// Only the three ACTIVE statuses are pulled. `complete` is history: it grows without
// bound and answers no question the operator has when they open this app, which is
// always some form of "what is stuck, and what do I do about it".

import { useCallback, useEffect, useState } from 'react'
import { adminGet, type IngestRow, type ReportIngestRow } from './api'

const ACTIVE_STATUSES = ['received', 'needs_review', 'ai_proposed'] as const

export interface QueueSnapshot {
  applications: IngestRow[]
  reports: ReportIngestRow[]
  loadedAt: number
}

export interface Buckets {
  /** Background run crashed — only Reprocess will move these. */
  stalled: IngestRow[]
  /** Arrived seconds ago; the pipeline is still working. Nothing to do. */
  processing: IngestRow[]
  /** Held because the programme name matched no open round. */
  outOfRound: IngestRow[]
  /** Held on the mapping itself: a required field, a one-of pair, a bad value. */
  needsMapping: IngestRow[]
  /** Created from an AI mapping, waiting for a human to agree it. */
  awaitingConfirmation: IngestRow[]
  reportsStalled: ReportIngestRow[]
  reportsProcessing: ReportIngestRow[]
  /** Held for want of a grant to attach to — the common report case, by design. */
  reportsNeedGrant: ReportIngestRow[]
  reportsNeedsMapping: ReportIngestRow[]
  reportsAwaitingConfirmation: ReportIngestRow[]
}

const ROUTING_CODES = new Set(['programme_unmapped', 'programme_unknown', 'programme_not_open'])

function has(row: { blockers?: Array<{ code: string }> }, codes: Set<string> | string): boolean {
  const blockers = row.blockers ?? []
  return typeof codes === 'string'
    ? blockers.some((b) => b.code === codes)
    : blockers.some((b) => codes.has(b.code))
}

export function bucketise(snapshot: QueueSnapshot | null): Buckets {
  const apps = snapshot?.applications ?? []
  const reports = snapshot?.reports ?? []
  const held = apps.filter((r) => r.status === 'needs_review')
  const heldReports = reports.filter((r) => r.status === 'needs_review')
  return {
    stalled: apps.filter((r) => has(r, 'pipeline_stalled')),
    processing: apps.filter((r) => has(r, 'pipeline_running')),
    // Routing wins over mapping when both apply: a submission with no open round to
    // land in cannot be resolved from the mapping grid at all, so listing it under
    // "needs mapping" would send the operator to a screen that can't help them.
    outOfRound: held.filter((r) => has(r, ROUTING_CODES)),
    needsMapping: held.filter((r) => !has(r, ROUTING_CODES)),
    awaitingConfirmation: apps.filter((r) => r.status === 'ai_proposed'),
    reportsStalled: reports.filter((r) => has(r, 'pipeline_stalled')),
    reportsProcessing: reports.filter((r) => has(r, 'pipeline_running')),
    reportsNeedGrant: heldReports.filter((r) => has(r, 'grant_unmatched')),
    reportsNeedsMapping: heldReports.filter((r) => !has(r, 'grant_unmatched')),
    reportsAwaitingConfirmation: reports.filter((r) => r.status === 'ai_proposed'),
  }
}

/** How many things are actually waiting on a person. Excludes rows still processing
 *  normally — a count that ticks up for work nobody has to do teaches people to
 *  ignore the badge. */
export function attentionCount(b: Buckets): number {
  return (
    b.stalled.length +
    b.outOfRound.length +
    b.needsMapping.length +
    b.awaitingConfirmation.length +
    b.reportsStalled.length +
    b.reportsNeedGrant.length +
    b.reportsNeedsMapping.length +
    b.reportsAwaitingConfirmation.length
  )
}

// ─── Shared store ────────────────────────────────────────────────────────────

let cache: QueueSnapshot | null = null
let inflight: Promise<QueueSnapshot> | null = null
const listeners = new Set<() => void>()

async function fetchSnapshot(): Promise<QueueSnapshot> {
  const [applications, reports] = await Promise.all([
    Promise.all(
      ACTIVE_STATUSES.map((s) => adminGet<IngestRow[]>(`/api/admin/ingests?status=${s}`)),
    ).then((lists) => lists.flat()),
    Promise.all(
      ACTIVE_STATUSES.map((s) => adminGet<ReportIngestRow[]>(`/api/admin/report-ingests?status=${s}`)),
    ).then((lists) => lists.flat()),
  ])
  return { applications, reports, loadedAt: Date.now() }
}

export function refreshQueues(): Promise<QueueSnapshot> {
  if (!inflight) {
    inflight = fetchSnapshot()
      .then((snap) => {
        cache = snap
        return snap
      })
      .finally(() => {
        inflight = null
        for (const fn of listeners) fn()
      })
  }
  return inflight
}

export function useQueues() {
  const [, bump] = useState(0)
  const [loading, setLoading] = useState(cache === null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    refreshQueues()
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const fn = () => bump((n) => n + 1)
    listeners.add(fn)
    if (cache === null) reload()
    return () => {
      listeners.delete(fn)
    }
  }, [reload])

  return { snapshot: cache, buckets: bucketise(cache), loading, error, reload }
}
