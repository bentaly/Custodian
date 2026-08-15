// Shared renderer for an application's fixed fields (the columns on
// `applications`) plus its dynamic form `responses`. Used by every place that
// shows an application's contents — the detail-page "View application" drawer and
// the shortlist "Briefing" drawer — so the layout stays consistent.

import { budgetTotal, formatPounds, type BudgetLine } from '../lib/budget'
import { C } from './ui/tokens'

// Accepts any application-shaped row; fields are optional so callers can pass
// whatever their query returned.
export type ApplicationFieldsData = {
  charityNumber?: string | null
  companyNumber?: string | null
  deliveryArea?: string | null
  amountRequested: string
  budgetBreakdown?: BudgetLine[] | null
  bankName?: string | null
  bankAccountName?: string | null
  bankAccountNumber?: string | null
  bankSortCode?: string | null
  responses?: Array<{ label: string; value: string }> | null
}

export type FieldRow = { label: string; value: string | null }

function fmtAmount(v: string | null) {
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

export function ApplicationFields({ application }: { application: ApplicationFieldsData }) {
  const detailRows = [
    { label: 'Amount requested', value: fmtAmount(application.amountRequested) },
    { label: 'Project delivery area', value: application.deliveryArea ?? null },
    { label: 'Charity number', value: application.charityNumber ?? null },
    { label: 'Company number', value: application.companyNumber ?? null },
  ].filter((r) => r.value)

  const bankRows = [
    { label: 'Bank name', value: application.bankName ?? null },
    { label: 'Account name', value: application.bankAccountName ?? null },
    { label: 'Account number', value: application.bankAccountNumber ?? null },
    { label: 'Sort code', value: application.bankSortCode ?? null },
  ].filter((r) => r.value)

  const responses = application.responses ?? []
  const budget = application.budgetBreakdown ?? []

  return (
    <div className="flex flex-col gap-6">
      <Section title="Application details">
        <KeyValueCard rows={detailRows} />
      </Section>

      {budget.length > 0 && (
        <Section title="Project budget">
          <div className="rounded-control border" style={{ borderColor: C.line }}>
            {budget.map((l, i) => (
              <div key={i} className="border-b px-4 py-2.5" style={{ borderColor: C.wash }}>
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
            <div className="flex justify-between gap-4 px-4 py-2.5 font-display text-body">
              <span className="font-medium" style={{ color: C.ink }}>
                Total project budget
              </span>
              <span className="text-right font-medium tabular-nums" style={{ color: C.ink }}>
                {formatPounds(budgetTotal(budget))}
              </span>
            </div>
          </div>
          {/* The budget covers the whole project; the ask may be a part of it. Said
              plainly so a total above "Amount requested" doesn't read as an error. */}
          <p className="mt-2 font-display text-label" style={{ color: C.faint }}>
            The cost of the whole project — this need not match the amount requested.
          </p>
        </Section>
      )}

      {bankRows.length > 0 && (
        <Section title="Bank details">
          <KeyValueCard rows={bankRows} />
        </Section>
      )}

      <Section title="Form responses">
        {responses.length === 0 ? (
          <p className="font-display text-body" style={{ color: C.faint }}>
            No form responses recorded.
          </p>
        ) : (
          <dl className="flex flex-col gap-5">
            {responses.map((r, i) => (
              <div key={i}>
                <dt className="mb-1 font-display text-label font-medium" style={{ color: C.sub }}>
                  {r.label}
                </dt>
                <dd
                  className="whitespace-pre-wrap font-display text-body leading-relaxed"
                  style={{ color: C.body }}
                >
                  {r.value || '—'}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Section>
    </div>
  )
}
