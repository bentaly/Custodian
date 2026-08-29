// Shared renderer for an application's submission — the fixed fields (the columns on
// `applications`) plus its dynamic form `responses`, shown as ONE list in the order
// the applicant filled the form in.
//
// It used to be four cards: a "details" card of the fields we recognised, then the
// budget, then bank details, then everything else under "Form responses". That order
// is ours, not the applicant's — it hoists four fields out of the middle of a form to
// the top and leaves the rest in an order nobody chose, because `raw_payload` is jsonb
// and Postgres normalises jsonb object keys by length. A real 38-question form came
// out as "Trustees, Full-time, Part-time, Volunteers, Budget total…". Reading a
// submission against the form it was made on was impossible.
//
// So `applications.submitted_fields` carries the running order (see the column
// comment; captured at `saveIngest`, the only moment it exists) and this renders it:
// the applicant's own question wording, in their sequence, with recognised fields
// sitting where they were actually asked. It is an INDEX — every value still comes
// from the columns, so nothing here can show a figure the application no longer holds,
// or a bank detail `getApplication` has redacted for this role.
//
// Applications with no index — imports, seeds, anything promoted before the column
// existed — fall back to a deliberate order of our own. Their true order is not
// recoverable: it was destroyed by the write that stored them.

import { budgetTotal, formatPounds, type BudgetLine } from '../lib/budget'
import { CANONICAL_FIELD_BY_KEY, type CanonicalFieldKey } from '../lib/fieldMapping'
import { C } from './ui/tokens'

// Accepts any application-shaped row; fields are optional so callers can pass
// whatever their query returned.
export type ApplicationFieldsData = {
  externalApplicationId?: string | null
  organisationName?: string | null
  applicantEmail?: string | null
  charityNumber?: string | null
  companyNumber?: string | null
  deliveryArea?: string | null
  amountRequested: string
  proposedImpactQuantity?: string | null
  budgetBreakdown?: BudgetLine[] | null
  budgetBreakdownLink?: string | null
  bankName?: string | null
  bankAccountName?: string | null
  bankAccountNumber?: string | null
  bankSortCode?: string | null
  responses?: Array<{ label: string; value: string }> | null
  submittedFields?: Array<{ label: string; canonical: string | null }> | null
}

export type FieldRow = { label: string; value: string | null }

function fmtAmount(v: string | null | undefined) {
  return v != null && v !== '' ? `£${Math.round(parseFloat(v)).toLocaleString('en-GB')}` : null
}

// Section + KeyValueCard are shared with ReportFields so both drawers render
// submitted content identically.
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3
        className="mb-3 font-display text-label font-semibold uppercase tracking-wide"
        style={{ color: C.faint }}
      >
        {title}
      </h3>
      {children}
    </section>
  )
}

export function KeyValueCard({ rows }: { rows: FieldRow[] }) {
  return (
    <div className="rounded-control border" style={{ borderColor: C.line }}>
      {rows.map((r) => (
        <div
          key={r.label}
          className="flex justify-between gap-4 border-b px-4 py-2.5 font-display text-body last:border-b-0"
          style={{ borderColor: C.wash }}
        >
          <span style={{ color: C.sub }}>{r.label}</span>
          <span className="text-right font-medium" style={{ color: C.ink }}>
            {r.value || '—'}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── The answer to one question ──────────────────────────────────────────────
//
// Everything the applicant sent is text except the two the pipeline gives a shape
// to — the budget, which has line items, and the budget document, which is a link
// someone clicks. Rendering those as text would be a regression on what the four-card
// version already did, so the kind travels with the value.
type Answer =
  | { kind: 'text'; value: string; emphasis?: boolean }
  | { kind: 'budget'; lines: BudgetLine[] }
  | { kind: 'link'; href: string }

/** The order used when an application carries no submitted-field index. */
const FALLBACK_ORDER: CanonicalFieldKey[] = [
  'externalApplicationId',
  'organisationName',
  'applicantEmail',
  'amountRequested',
  'deliveryArea',
  'charityNumber',
  'companyNumber',
  'proposedImpactQuantity',
  'budgetBreakdown',
  'budgetBreakdownLink',
  'bankName',
  'bankAccountName',
  'bankAccountNumber',
  'bankSortCode',
]

function answerFor(
  application: ApplicationFieldsData,
  canonical: string,
  programmeName?: string | null,
): Answer | null {
  const text = (v: string | null | undefined, emphasis = false): Answer | null =>
    v != null && v !== '' ? { kind: 'text', value: v, emphasis } : null

  switch (canonical as CanonicalFieldKey) {
    // Not a column on `applications` — the programme is reached through the round
    // programme, so the caller passes the name it already has for its own header.
    case 'programmeName':
      return text(programmeName)
    case 'externalApplicationId':
      return text(application.externalApplicationId)
    case 'organisationName':
      return text(application.organisationName)
    case 'applicantEmail':
      return text(application.applicantEmail)
    case 'amountRequested':
      return text(fmtAmount(application.amountRequested), true)
    case 'proposedImpactQuantity':
      return text(
        application.proposedImpactQuantity != null
          ? Number(application.proposedImpactQuantity).toLocaleString('en-GB')
          : null,
        true,
      )
    case 'deliveryArea':
      return text(application.deliveryArea)
    case 'charityNumber':
      return text(application.charityNumber)
    case 'companyNumber':
      return text(application.companyNumber)
    case 'bankName':
      return text(application.bankName)
    case 'bankAccountName':
      return text(application.bankAccountName)
    case 'bankAccountNumber':
      return text(application.bankAccountNumber, true)
    case 'bankSortCode':
      return text(application.bankSortCode, true)
    case 'budgetBreakdown':
      return application.budgetBreakdown?.length
        ? { kind: 'budget', lines: application.budgetBreakdown }
        : null
    case 'budgetBreakdownLink':
      return application.budgetBreakdownLink
        ? { kind: 'link', href: application.budgetBreakdownLink }
        : null
    default:
      return null
  }
}

type Entry = { label: string; answer: Answer }

/**
 * The submission as a list of question/answer pairs.
 *
 * A field named in the index with nothing behind it is DROPPED rather than shown
 * empty: the index is written at promotion and the columns can move afterwards (a
 * reviewer remaps, `getApplication` redacts the bank details for a trustee), and a
 * row of dashes would state that the applicant left something blank when they did
 * not. The reverse — a value with no entry in the index — is appended, so a field a
 * reviewer typed in by hand (which has no incoming question to sit beside) still
 * appears rather than silently going missing.
 */
function buildEntries(application: ApplicationFieldsData, programmeName?: string | null): Entry[] {
  const responses = application.responses ?? []
  const responseByLabel = new Map(responses.map((r) => [r.label, r.value]))
  const index = application.submittedFields ?? null

  const entries: Entry[] = []
  const usedCanonical = new Set<string>()
  const usedResponses = new Set<string>()

  const pushCanonical = (canonical: string, label: string) => {
    if (usedCanonical.has(canonical)) return
    const answer = answerFor(application, canonical, programmeName)
    if (!answer) return
    usedCanonical.add(canonical)
    entries.push({ label, answer })
  }

  if (index) {
    for (const field of index) {
      if (field.canonical) {
        const before = usedCanonical.size
        // A sender that named a field by our OWN canonical key has given us an
        // identifier, not a question: Arete's integration posted `externalApplicationId`
        // and `programmeName` verbatim, and labelling the row with the raw key would
        // print "externalApplicationId" at a trustee. Everywhere else the label is the
        // applicant's own wording and is exactly what should be shown.
        pushCanonical(
          field.canonical,
          field.label === field.canonical
            ? (CANONICAL_FIELD_BY_KEY[field.canonical as CanonicalFieldKey]?.label ?? field.label)
            : field.label,
        )
        if (usedCanonical.size > before) continue
        // A canonical field with no value on the row can still have survived as a
        // response — `buildCanonicalInput` does exactly that with a prose budget
        // narrative that would not parse into line items. Fall through and look.
      }
      const value = responseByLabel.get(field.label)
      if (value == null || value === '' || usedResponses.has(field.label)) continue
      usedResponses.add(field.label)
      entries.push({ label: field.label, answer: { kind: 'text', value } })
    }
  }

  // Canonical fields the index never mentioned, in our own order: everything on an
  // application with no index, and on one with an index the values a reviewer typed
  // rather than mapped.
  for (const key of FALLBACK_ORDER) {
    pushCanonical(key, CANONICAL_FIELD_BY_KEY[key].label)
  }
  for (const r of responses) {
    if (usedResponses.has(r.label) || !r.value) continue
    usedResponses.add(r.label)
    entries.push({ label: r.label, answer: { kind: 'text', value: r.value } })
  }

  return entries
}

function BudgetAnswer({ lines }: { lines: BudgetLine[] }) {
  return (
    <>
      <div className="rounded-control border" style={{ borderColor: C.line }}>
        {lines.map((l, i) => (
          <div key={i} className="border-b px-3 py-2" style={{ borderColor: C.wash }}>
            <div className="flex justify-between gap-4 font-display text-body">
              <span style={{ color: C.sub }}>{l.item}</span>
              <span className="text-right font-medium tabular-nums" style={{ color: C.ink }}>
                {formatPounds(l.amount)}
              </span>
            </div>
            {/* Extra fields the applicant entered on this line (a description, a
                cost type…). Shown, but not part of the item/amount breakdown. */}
            {l.details && l.details.length > 0 && (
              <dl className="mt-1.5 flex flex-col gap-0.5">
                {l.details.map((d, j) => (
                  <div
                    key={j}
                    className="flex gap-2 font-display text-label"
                    style={{ color: C.faint }}
                  >
                    <dt className="shrink-0">{d.label}:</dt>
                    <dd className="whitespace-pre-wrap" style={{ color: C.sub }}>
                      {d.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ))}
        <div className="flex justify-between gap-4 px-3 py-2 font-display text-body">
          <span className="font-medium" style={{ color: C.ink }}>
            Total project budget
          </span>
          <span className="text-right font-medium tabular-nums" style={{ color: C.ink }}>
            {formatPounds(budgetTotal(lines))}
          </span>
        </div>
      </div>
      {/* The budget covers the whole project; the ask may be a part of it. Said
          plainly so a total above "Amount requested" doesn't read as an error. */}
      <p className="mt-2 font-display text-label" style={{ color: C.faint }}>
        The cost of the whole project — this need not match the amount requested.
      </p>
    </>
  )
}

function AnswerBody({ answer }: { answer: Answer }) {
  if (answer.kind === 'budget') return <BudgetAnswer lines={answer.lines} />
  if (answer.kind === 'link') {
    return (
      <a
        href={answer.href}
        target="_blank"
        rel="noreferrer"
        className="break-all font-display text-body underline underline-offset-2"
        style={{ color: C.brand }}
      >
        {answer.href}
      </a>
    )
  }
  return (
    <p
      className={`whitespace-pre-wrap font-display text-body leading-relaxed ${
        answer.emphasis ? 'font-medium tabular-nums' : ''
      }`}
      style={{ color: C.ink }}
    >
      {answer.value}
    </p>
  )
}

export function ApplicationFields({
  application,
  programmeName,
}: {
  application: ApplicationFieldsData
  /** The programme applied to, for the incoming field that named it. */
  programmeName?: string | null
}) {
  const entries = buildEntries(application, programmeName)

  if (entries.length === 0) {
    return (
      <p className="font-display text-body" style={{ color: C.faint }}>
        No submitted fields recorded.
      </p>
    )
  }

  return (
    <dl className="flex flex-col">
      {entries.map((e, i) => (
        <div
          key={`${e.label}-${i}`}
          className={i > 0 ? 'mt-4 border-t pt-4 pb-1' : 'pb-1'}
          style={i > 0 ? { borderColor: C.line } : undefined}
        >
          <dt className="mb-1.5 font-display text-label font-medium" style={{ color: C.sub }}>
            {e.label}
          </dt>
          <dd>
            <AnswerBody answer={e.answer} />
          </dd>
        </div>
      ))}
    </dl>
  )
}
