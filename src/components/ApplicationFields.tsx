// Shared renderer for an application's fixed fields (the columns on
// `applications`) plus its dynamic form `responses`. Used by every place that
// shows an application's contents — the detail-page "View application" drawer and
// the shortlist "Briefing" drawer — so the layout stays consistent.

// Accepts any application-shaped row; fields are optional so callers can pass
// whatever their query returned.
export type ApplicationFieldsData = {
  charityNumber?: string | null
  companyNumber?: string | null
  amountRequested: string
  bankName?: string | null
  bankAccountName?: string | null
  bankAccountNumber?: string | null
  bankSortCode?: string | null
  responses?: Array<{ label: string; value: string }> | null
}

type FieldRow = { label: string; value: string | null }

function fmtAmount(v: string | null) {
  return v != null && v !== '' ? `£${Math.round(parseFloat(v)).toLocaleString('en-GB')}` : null
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
        {title}
      </h3>
      {children}
    </section>
  )
}

function KeyValueCard({ rows }: { rows: FieldRow[] }) {
  return (
    <div className="rounded-lg border border-gray-200">
      {rows.map((r) => (
        <div
          key={r.label}
          className="flex justify-between gap-4 border-b border-gray-100 px-4 py-2.5 text-sm last:border-b-0"
        >
          <span className="text-gray-500">{r.label}</span>
          <span className="text-right font-medium text-gray-900">{r.value || '—'}</span>
        </div>
      ))}
    </div>
  )
}

export function ApplicationFields({ application }: { application: ApplicationFieldsData }) {
  const detailRows = [
    { label: 'Amount requested', value: fmtAmount(application.amountRequested) },
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

  return (
    <div className="space-y-6">
      <Section title="Application details">
        <KeyValueCard rows={detailRows} />
      </Section>

      {bankRows.length > 0 && (
        <Section title="Bank details">
          <KeyValueCard rows={bankRows} />
        </Section>
      )}

      <Section title="Form responses">
        {responses.length === 0 ? (
          <p className="text-sm text-gray-400">No form responses recorded.</p>
        ) : (
          <dl className="space-y-5">
            {responses.map((r, i) => (
              <div key={i}>
                <dt className="mb-1 text-xs font-medium text-gray-500">{r.label}</dt>
                <dd className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
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
