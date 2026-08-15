import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert01Icon,
  CheckmarkCircle02Icon,
  Download04Icon,
  File01Icon,
  InformationCircleIcon,
  Upload04Icon,
} from '@hugeicons/core-free-icons'
import {
  commitImport,
  getImportContext,
  listImportBatches,
  prepareImport,
  rollbackImport,
} from '../../server/fns/dataImport'
import { Breadcrumb, Button, Select } from '../../components/ui'
import { C } from '../../components/ui/tokens'
import { columnAsk, SHEETS } from '../../lib/dataImport/columns'
import type { CellIssue, GrantRow, PaymentRow, ReportRow } from '../../lib/dataImport/parse'
import { fmtDate, fmtMoney } from '../../lib/format'

export const Route = createFileRoute('/_authenticated/settings/data-import')({
  // Importing writes a foundation's whole back catalogue and can delete it again.
  beforeLoad: ({ context }) => {
    const isAdmin = context.user.role === 'admin' || context.user.role === 'superadmin'
    if (!isAdmin) throw redirect({ to: '/settings' })
  },
  loader: async () => ({
    context: await getImportContext(),
    batches: await listImportBatches(),
  }),
  component: DataImport,
})

// Borders for the two issue tints. The token set has `brandBorder` at 20% of the brand
// colour but no amber/danger equivalent yet; these follow that same rule so they can be
// lifted into tokens.ts unchanged when it grows.
const WARN_BORDER = 'rgba(155, 105, 22, 0.2)'
const ERROR_BORDER = 'rgba(255, 66, 66, 0.2)'

type Prepared = Awaited<ReturnType<typeof prepareImport>>
type Committed = Awaited<ReturnType<typeof commitImport>>

type Payload = {
  grants: GrantRow[]
  payments: PaymentRow[]
  reports: ReportRow[]
  cellIssues: CellIssue[]
}

type Step = 'prepare' | 'review' | 'reconcile' | 'done'

const STEPS: Array<{ key: Step; label: string }> = [
  { key: 'prepare', label: 'Prepare' },
  { key: 'review', label: 'Review' },
  { key: 'reconcile', label: 'Reconcile' },
]

// ─── Chrome ─────────────────────────────────────────────────────────────────

function Stepper({ step }: { step: Step }) {
  const index = STEPS.findIndex((s) => s.key === step)
  const current = step === 'done' ? STEPS.length : index
  return (
    <div className="flex flex-wrap items-center gap-y-2">
      {STEPS.map((s, i) => {
        const done = i < current
        const active = i === current
        return (
          <div key={s.key} className="flex items-center">
            <span
              className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-label font-semibold"
              style={
                active
                  ? { backgroundColor: C.brand, color: '#fff' }
                  : done
                    ? { backgroundColor: C.brandWash, color: C.brand }
                    : { backgroundColor: 'var(--color-grey-100)', color: 'var(--color-grey-400)' }
              }
            >
              {done ? '✓' : i + 1}
            </span>
            <span
              className="ml-2 text-label"
              style={{ color: active ? C.ink : C.sub, fontWeight: active ? 500 : 400 }}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="mx-3 h-px w-8" style={{ backgroundColor: C.line }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function Panel({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-card border bg-white p-4" style={{ borderColor: C.line }}>
      {/* The panel heading the rest of the app uses (`ui/Detail`'s PanelTitle): 16px
          medium, not 14px semibold. This screen predates it. */}
      <h2 className="font-display text-title font-medium" style={{ color: C.ink }}>
        {title}
      </h2>
      {description && (
        <p className="mt-1 font-display text-body leading-relaxed" style={{ color: C.sub }}>
          {description}
        </p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Figure({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string
  value: string
  sub?: string
  emphasis?: boolean
}) {
  return (
    <div
      className="rounded-control border p-4"
      style={{
        borderColor: emphasis ? C.brandWash : C.line,
        backgroundColor: emphasis ? 'var(--color-background)' : '#fff',
      }}
    >
      <div className="text-label font-semibold tracking-wide uppercase" style={{ color: C.sub }}>
        {label}
      </div>
      <div
        className="font-display mt-1.5 text-heading leading-none font-medium"
        style={{ color: emphasis ? C.brand : C.ink }}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-1 text-label" style={{ color: C.sub }}>
          {sub}
        </div>
      )}
    </div>
  )
}

function IssueRow({
  kind,
  message,
  detail,
  rows,
}: {
  kind: 'blocker' | 'degradation'
  message: string
  detail: string
  rows: number[]
}) {
  const blocker = kind === 'blocker'
  return (
    <li
      className="flex gap-3 rounded-control border p-3.5"
      style={{
        borderColor: blocker ? ERROR_BORDER : WARN_BORDER,
        backgroundColor: blocker ? C.dangerWash : C.amberWash,
      }}
    >
      <HugeiconsIcon
        icon={blocker ? Alert01Icon : InformationCircleIcon}
        className="mt-px h-[18px] w-[18px] shrink-0"
        strokeWidth={1.8}
        style={{ color: blocker ? C.danger : C.amber }}
      />
      <div className="min-w-0">
        <div className="text-body font-medium" style={{ color: blocker ? C.danger : C.amber }}>
          {message}
        </div>
        <div className="mt-0.5 text-label leading-relaxed" style={{ color: C.sub }}>
          {detail}
        </div>
        {rows.length > 0 && (
          <div className="mt-1.5 text-label" style={{ color: C.sub }}>
            {rows.length === 1 ? 'Row ' : 'Rows '}
            {rows.slice(0, 12).join(', ')}
            {rows.length > 12 && ` and ${rows.length - 12} more`}
          </div>
        )}
      </div>
    </li>
  )
}

// ─── Screen ─────────────────────────────────────────────────────────────────

function DataImport() {
  const { context, batches } = Route.useLoaderData()
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('prepare')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [payload, setPayload] = useState<Payload | null>(null)
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [result, setResult] = useState<Committed | null>(null)
  const [dragging, setDragging] = useState(false)

  // Confirmed choices for values the dropdowns didn't catch — keyed by the exact
  // string in the file. `null` for a round means "create it".
  const [programmeChoice, setProgrammeChoice] = useState<Record<string, string>>({})
  const [roundChoice, setRoundChoice] = useState<Record<string, string | null>>({})

  const blockers = prepared?.issues.filter((i) => i.kind === 'blocker') ?? []
  const degradations = prepared?.issues.filter((i) => i.kind === 'degradation') ?? []

  // Anything not settled by an exact match needs a decision before we can commit.
  const openProgrammes =
    prepared?.resolutions.programmes.filter((r) => r.match.kind !== 'exact') ?? []
  const openRounds = prepared?.resolutions.rounds.filter((r) => r.match.kind !== 'exact') ?? []
  const unresolved =
    openProgrammes.filter((r) => !programmeChoice[r.value]).length +
    openRounds.filter((r) => roundChoice[r.value] === undefined).length

  async function handleDownloadTemplate() {
    setBusy('template')
    setError('')
    try {
      const { buildTemplate } = await import('../../lib/dataImport/workbook')
      const blob = await buildTemplate({
        clientId: context.clientId,
        foundationName: context.foundationName,
        lookups: {
          programmes: context.programmes.map((p) => p.name),
          rounds: context.rounds.map((r) => r.name),
        },
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `custodian-import-${context.foundationName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the template.')
    } finally {
      setBusy(null)
    }
  }

  async function handleFile(file: File) {
    setBusy('upload')
    setError('')
    setFileName(file.name)
    try {
      const [{ readWorkbook, WorkbookError }, parse] = await Promise.all([
        import('../../lib/dataImport/workbook'),
        import('../../lib/dataImport/parse'),
      ])

      const read = await readWorkbook(file)

      // A file generated for a different foundation would import their programme names
      // into this tenant. Say so plainly rather than trying to make sense of it.
      if (read.fingerprint && read.fingerprint.clientId !== context.clientId) {
        throw new WorkbookError(
          'That template was generated for a different foundation. Download a fresh one below.',
        )
      }
      if (read.missingHeaders.grants.length > 0) {
        throw new WorkbookError(
          `The Grants sheet is missing these columns: ${read.missingHeaders.grants.join(', ')}. Download a fresh template and copy your data into it.`,
        )
      }

      const grants = parse.parseGrants(read.sheets.grants)
      const payments = parse.parsePayments(read.sheets.payments)
      const reportRows = parse.parseReports(read.sheets.reports)

      const next: Payload = {
        grants: grants.rows,
        payments: payments.rows,
        reports: reportRows.rows,
        cellIssues: [...grants.issues, ...payments.issues, ...reportRows.issues],
      }
      setPayload(next)

      const check = await prepareImport({ data: next })
      setPrepared(check)

      // Pre-select the suggestions. Everything still needs a click, but the click is
      // a confirmation rather than a lookup.
      const p: Record<string, string> = {}
      for (const r of check.resolutions.programmes) {
        if (r.match.kind === 'suggestion') p[r.value] = r.match.candidate.id
      }
      setProgrammeChoice(p)
      const rd: Record<string, string | null> = {}
      for (const r of check.resolutions.rounds) {
        if (r.match.kind === 'suggestion') rd[r.value] = r.match.candidate.id
        // No close round match means it is almost certainly a historic round that was
        // never in Custodian, so default to creating it.
        else if (r.match.kind === 'none') rd[r.value] = null
      }
      setRoundChoice(rd)

      setStep('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file could not be read.')
      setFileName(null)
    } finally {
      setBusy(null)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function handleCommit() {
    if (!payload || !prepared) return
    setBusy('commit')
    setError('')
    try {
      const programmesMap: Record<string, string> = {}
      for (const r of prepared.resolutions.programmes) {
        const id = r.match.kind === 'exact' ? r.match.candidate.id : programmeChoice[r.value]
        if (id) programmesMap[r.value] = id
      }
      const roundsMap: Record<string, string | null> = {}
      for (const r of prepared.resolutions.rounds) {
        roundsMap[r.value] =
          r.match.kind === 'exact' ? r.match.candidate.id : (roundChoice[r.value] ?? null)
      }

      const committed = await commitImport({
        data: {
          payload,
          mapping: { programmes: programmesMap, rounds: roundsMap },
          fileName,
          acceptedWarnings: degradations.map((d) => d.code),
        },
      })
      setResult(committed)
      setStep('done')
      await router.invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The import could not be completed.')
    } finally {
      setBusy(null)
    }
  }

  async function handleRollback(batchId: string) {
    setBusy(batchId)
    setError('')
    try {
      await rollbackImport({ data: { batchId } })
      await router.invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That import could not be undone.')
    } finally {
      setBusy(null)
    }
  }

  function reset() {
    setStep('prepare')
    setPayload(null)
    setPrepared(null)
    setResult(null)
    setFileName(null)
    setError('')
  }

  const rec = prepared?.reconciliation

  return (
    // Same header as `SettingsPage` gives every other settings screen. This page does not
    // use that shell because its stepper sits between the title and the body.
    <div className="max-w-4xl">
      <Breadcrumb items={[{ label: 'Settings', to: '/settings' }, { label: 'Data import' }]} />
      <h1 className="mt-4 font-display text-heading font-medium" style={{ color: C.ink }}>
        Data import
      </h1>
      <p className="mt-1 max-w-2xl font-display text-body leading-relaxed" style={{ color: C.sub }}>
        Bring the grants you have already made into Custodian, so your payments, reports and totals
        are right from the day you start. Begin with the grants that still owe you money or a report
        — you can come back and add the rest later.
      </p>

      <div className="mt-7">
        <Stepper step={step} />
      </div>

      {error && (
        <div
          className="mt-6 rounded-control border px-4 py-3 text-body"
          style={{ borderColor: ERROR_BORDER, backgroundColor: C.dangerWash, color: C.danger }}
        >
          {error}
        </div>
      )}

      {/* ── Step 1: prepare ── */}
      {step === 'prepare' && (
        <div className="mt-6 space-y-5">
          {context.programmes.length === 0 ? (
            <Panel
              title="Set up your programmes first"
              description="Every grant is imported against one of your programmes, and the template builds its dropdowns from them. Add your programmes, then come back — it takes a couple of minutes and saves a great deal of tidying up afterwards."
            >
              <Button onClick={() => router.navigate({ to: '/programmes' })}>
                Go to programmes
              </Button>
            </Panel>
          ) : (
            <>
              <Panel
                title="1. Download your template"
                description="This workbook is built for you: the Programme and Round columns already contain your own lists, so there is nothing to match up afterwards."
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={handleDownloadTemplate} disabled={busy === 'template'}>
                    <span className="flex items-center gap-2">
                      <HugeiconsIcon icon={Download04Icon} className="h-4 w-4" strokeWidth={1.8} />
                      {busy === 'template' ? 'Building…' : 'Download template'}
                    </span>
                  </Button>
                  <span className="text-label" style={{ color: C.sub }}>
                    {context.programmes.length} programme
                    {context.programmes.length === 1 ? '' : 's'} · {context.rounds.length} round
                    {context.rounds.length === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {(['grants', 'payments', 'reports'] as const).map((key) => (
                    <div
                      key={key}
                      className="rounded-control border p-3.5"
                      style={{ borderColor: C.line }}
                    >
                      <div className="font-display text-body font-medium" style={{ color: C.ink }}>
                        {SHEETS[key].title}
                      </div>
                      <div className="mt-1 text-label leading-relaxed" style={{ color: C.sub }}>
                        {SHEETS[key].blurb}
                      </div>
                      <div className="mt-2.5 text-label" style={{ color: C.sub }}>
                        {/* Counted the way the workbook labels them, not by tier — this
                            card is describing the file they are about to fill in. */}
                        {SHEETS[key].columns.filter((c) => columnAsk(c) === 'required').length}{' '}
                        required column
                        {SHEETS[key].columns.filter((c) => columnAsk(c) === 'required').length === 1
                          ? ''
                          : 's'}
                        , {SHEETS[key].columns.length} in total
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel
                title="2. Upload it back"
                description="We check everything before anything is saved, and show you the totals to confirm against your own accounts."
              >
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragging(true)
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragging(false)
                    const file = e.dataTransfer.files?.[0]
                    if (file) void handleFile(file)
                  }}
                  className="rounded-control border-2 border-dashed px-6 py-10 text-center transition-colors"
                  style={{
                    borderColor: dragging ? C.brand : C.line,
                    backgroundColor: dragging
                      ? 'var(--color-background)'
                      : 'var(--color-background)',
                  }}
                >
                  <HugeiconsIcon
                    icon={Upload04Icon}
                    className="mx-auto h-7 w-7"
                    strokeWidth={1.5}
                    style={{ color: dragging ? C.brand : 'var(--color-grey-400)' }}
                  />
                  <div className="mt-3 text-body" style={{ color: C.ink }}>
                    {busy === 'upload' ? (
                      'Reading your workbook…'
                    ) : (
                      <>
                        Drop your completed workbook here, or{' '}
                        <button
                          onClick={() => fileInput.current?.click()}
                          className="font-medium underline underline-offset-2"
                          style={{ color: C.brand }}
                        >
                          browse for it
                        </button>
                      </>
                    )}
                  </div>
                  <div className="mt-1 text-label" style={{ color: C.sub }}>
                    Excel workbooks (.xlsx) only
                  </div>
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void handleFile(file)
                    }}
                  />
                </div>
              </Panel>
            </>
          )}

          {batches.length > 0 && (
            <History batches={batches} busy={busy} onRollback={handleRollback} />
          )}
        </div>
      )}

      {/* ── Step 2: review ── */}
      {step === 'review' && prepared && (
        <div className="mt-6 space-y-5">
          <div className="flex items-center gap-2 text-body" style={{ color: C.sub }}>
            <HugeiconsIcon icon={File01Icon} className="h-4 w-4" strokeWidth={1.8} />
            {fileName} · {prepared.reconciliation.grants} grants, {prepared.reconciliation.payments}{' '}
            payments, {prepared.reconciliation.reportMilestones} reporting milestones
            {prepared.replacing > 0 && ` · ${prepared.replacing} already imported, will be updated`}
          </div>

          {(openProgrammes.length > 0 || openRounds.length > 0) && (
            <Panel
              title="Confirm a few names"
              description="These don’t exactly match anything you have. That usually means they were pasted in rather than picked from the dropdown. Each decision applies to every row using that name."
            >
              <div className="space-y-3">
                {openProgrammes.map((r) => (
                  <div
                    key={`p-${r.value}`}
                    className="flex flex-wrap items-center gap-3 rounded-control border p-3"
                    style={{ borderColor: C.line }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-body font-medium" style={{ color: C.ink }}>
                        “{r.value}”
                      </div>
                      <div className="text-label" style={{ color: C.sub }}>
                        Programme · {r.rowCount} row{r.rowCount === 1 ? '' : 's'}
                        {r.reason && ` · ${r.reason}`}
                      </div>
                    </div>
                    {/* The app's Select, not the browser's — these were the last two
                        native dropdowns left in the product. */}
                    <Select
                      className="w-56 shrink-0"
                      aria-label={`Programme for “${r.value}”`}
                      value={programmeChoice[r.value] ?? ''}
                      onChange={(next) =>
                        setProgrammeChoice((prev) => ({ ...prev, [r.value]: next }))
                      }
                      placeholder="Choose a programme…"
                      options={prepared.programmes.map((p) => ({ value: p.id, label: p.name }))}
                    />
                  </div>
                ))}

                {openRounds.map((r) => (
                  <div
                    key={`r-${r.value}`}
                    className="flex flex-wrap items-center gap-3 rounded-control border p-3"
                    style={{ borderColor: C.line }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-body font-medium" style={{ color: C.ink }}>
                        “{r.value}”
                      </div>
                      <div className="text-label" style={{ color: C.sub }}>
                        Round · {r.rowCount} row{r.rowCount === 1 ? '' : 's'}
                        {r.reason && ` · ${r.reason}`}
                      </div>
                    </div>
                    <Select
                      className="w-56 shrink-0"
                      aria-label={`Round for “${r.value}”`}
                      value={
                        roundChoice[r.value] === null ? '__new__' : (roundChoice[r.value] ?? '')
                      }
                      onChange={(next) =>
                        setRoundChoice((prev) => ({
                          ...prev,
                          [r.value]: next === '__new__' ? null : next,
                        }))
                      }
                      options={[
                        { value: '__new__', label: `Create “${r.value}” as a new round` },
                        ...prepared.rounds.map((p) => ({ value: p.id, label: p.name })),
                      ]}
                    />
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {blockers.length > 0 && (
            <Panel
              title={`${blockers.length} thing${blockers.length === 1 ? '' : 's'} to fix`}
              description="These stop the import. Correct them in your workbook and upload it again."
            >
              <ul className="space-y-2.5">
                {blockers.map((issue, i) => (
                  <IssueRow key={`${issue.code}-${i}`} {...issue} />
                ))}
              </ul>
            </Panel>
          )}

          {degradations.length > 0 && (
            <Panel
              title="What will be missing"
              description="None of these stop the import. They tell you what won’t work for the grants concerned, so nothing comes as a surprise later."
            >
              <ul className="space-y-2.5">
                {degradations.map((issue, i) => (
                  <IssueRow key={`${issue.code}-${i}`} {...issue} />
                ))}
              </ul>
            </Panel>
          )}

          {blockers.length === 0 && degradations.length === 0 && (
            <Panel title="Nothing to flag">
              <div className="flex items-center gap-2.5 text-body" style={{ color: C.brand }}>
                <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-5 w-5" strokeWidth={1.8} />
                Every row read cleanly, with nothing missing.
              </div>
            </Panel>
          )}

          <div className="flex items-center justify-between">
            <Button variant="secondary" onClick={reset}>
              Start again
            </Button>
            <div className="flex items-center gap-3">
              {unresolved > 0 && (
                <span className="text-label" style={{ color: C.sub }}>
                  {unresolved} name{unresolved === 1 ? '' : 's'} still to confirm
                </span>
              )}
              <Button
                onClick={() => setStep('reconcile')}
                disabled={blockers.length > 0 || unresolved > 0}
              >
                Continue to reconciliation
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 3: reconcile ── */}
      {step === 'reconcile' && rec && (
        <div className="mt-6 space-y-5">
          <Panel
            title="Check these against your own accounts"
            description="This is the moment worth taking slowly. If these three figures match your records, everything Custodian shows you from here rests on solid ground. If they don’t, better to find out now."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Figure
                label="Total committed"
                value={fmtMoney(rec.totalCommitted)}
                emphasis
                sub={`across ${rec.grants} grants`}
              />
              <Figure label="Paid to date" value={fmtMoney(rec.totalPaid)} emphasis />
              <Figure
                label="Still to pay"
                value={fmtMoney(rec.totalOutstanding)}
                emphasis
                sub={`${rec.payments} payments in total`}
              />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <Figure label="Active grants" value={String(rec.activeGrants)} />
              <Figure label="Completed" value={String(rec.completedGrants)} />
              <Figure label="Reporting milestones" value={String(rec.reportMilestones)} />
              <Figure label="Reports outstanding" value={String(rec.reportsOutstanding)} />
            </div>
          </Panel>

          <Panel title="What happens when you confirm">
            <ul className="space-y-2 text-body leading-relaxed" style={{ color: C.sub }}>
              <li>
                Every grant is marked as imported, permanently, so its blanks read as history rather
                than missing data.
              </li>
              <li>
                <strong style={{ color: C.ink }}>No award letters are sent.</strong> Nobody is
                emailed by an import.
              </li>
              <li>
                Registration numbers and locations are stored, but due diligence and deprivation
                context are <strong style={{ color: C.ink }}>not</strong> run automatically —
                screening a whole back catalogue at once would mean thousands of calls to the
                Charity Commission and Companies House. Run it per grant from the application when
                you need it.
              </li>
              <li>
                Imported grants carry no Custodian score. Scoring a decision made years ago against
                today’s priorities would produce a confident, meaningless number.
              </li>
              <li>
                You can undo the whole thing afterwards, as long as nobody has started working with
                it.
              </li>
            </ul>
          </Panel>

          <div className="flex items-center justify-between">
            <Button variant="secondary" onClick={() => setStep('review')}>
              Back
            </Button>
            <Button onClick={handleCommit} disabled={busy === 'commit'}>
              {busy === 'commit' ? 'Importing…' : `Import ${rec.grants} grants`}
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 4: done ── */}
      {step === 'done' && result && (
        <div className="mt-6 space-y-5">
          <Panel title="Imported">
            <div className="flex items-start gap-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: C.brandWash, color: C.brand }}
              >
                <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-5 w-5" strokeWidth={1.8} />
              </span>
              <div className="text-body leading-relaxed" style={{ color: C.ink }}>
                {result.grants} grants, {result.payments} payments and {result.reportMilestones}{' '}
                reporting milestones are now in Custodian.
                {result.replaced > 0 &&
                  ` ${result.replaced} previously imported grants were updated.`}
                {result.roundsCreated.length > 0 && (
                  <> New rounds created: {result.roundsCreated.join(', ')}.</>
                )}
              </div>
            </div>
          </Panel>

          {result.generatedReferences.length > 0 && (
            <Panel
              title="References we generated"
              description="These grants arrived without a reference of their own. A charity needs to quote its reference for a future report to link itself automatically, so keep this list."
            >
              <div
                className="max-h-64 overflow-y-auto rounded-control border"
                style={{ borderColor: C.line }}
              >
                <table className="w-full text-label">
                  <tbody>
                    {result.generatedReferences.map((g) => (
                      <tr
                        key={g.reference}
                        className="border-b last:border-b-0"
                        style={{ borderColor: C.line }}
                      >
                        <td className="px-3 py-2" style={{ color: C.ink }}>
                          {g.organisationName}
                        </td>
                        <td className="px-3 py-2 text-right font-mono" style={{ color: C.sub }}>
                          {g.reference}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={() => router.navigate({ to: '/finance' })}>Go to Finance</Button>
            <Button variant="secondary" onClick={reset}>
              Import another file
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Import history ─────────────────────────────────────────────────────────

function History({
  batches,
  busy,
  onRollback,
}: {
  batches: Awaited<ReturnType<typeof listImportBatches>>
  busy: string | null
  onRollback: (id: string) => void
}) {
  return (
    <Panel
      title="Previous imports"
      description="Each import can be undone in one go, as long as nobody has commented, voted, or had a report come in against its grants."
    >
      <div className="space-y-2.5">
        {batches.map((b) => {
          const undone = b.status === 'rolled_back'
          // A later import of the same references replaces this batch's rows, leaving it
          // owning nothing. Saying so beats offering an Undo that removes nothing.
          const superseded = !undone && b.liveGrantCount === 0
          const spent = undone || superseded
          return (
            <div
              key={b.id}
              className="flex flex-wrap items-center gap-3 rounded-control border p-3.5"
              style={{ borderColor: C.line, opacity: spent ? 0.6 : 1 }}
            >
              <div className="min-w-0 flex-1">
                <div className="text-body font-medium" style={{ color: C.ink }}>
                  {b.grantCount} grants · {fmtMoney(b.totalCommitted)} committed
                  {undone && ' · undone'}
                  {superseded && ' · replaced by a later import'}
                </div>
                <div className="mt-0.5 text-label" style={{ color: C.sub }}>
                  {fmtDate(b.createdAt)}
                  {b.createdByName && ` · ${b.createdByName}`}
                  {b.fileName && ` · ${b.fileName}`}
                </div>
              </div>
              {!spent && (
                <Button
                  variant="dangerGhost"
                  size="xs"
                  onClick={() => onRollback(b.id)}
                  disabled={busy === b.id}
                >
                  {busy === b.id ? 'Undoing…' : 'Undo'}
                </Button>
              )}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
