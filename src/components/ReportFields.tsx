// Shared renderer for a report submission's contents: the fixed canonical
// fields plus the unmapped `responses`, mirroring ApplicationFields so the
// "View report" drawer reads exactly like the "View application" one.

import { KeyValueCard, Section, type FieldRow } from './ApplicationFields'
import { C } from './ui/tokens'
import { fmtDate } from '../lib/format'

export type ReportFieldsData = {
  submittedAt: string
  matchMethod: 'external_id' | 'manual' | 'import'
  externalApplicationId?: string | null
  charityNumber?: string | null
  companyNumber?: string | null
  contactName?: string | null
  contactEmail?: string | null
  contactPhone?: string | null
  amountAwarded?: string | null
  beneficiaryCount?: number | null
  awardDate?: string | null
  awardEndDate?: string | null
  deliveryArea?: string | null
  grantTitle?: string | null
  grantPurpose?: string | null
  impactSummary: string
  challenges?: string | null
  lessons?: string | null
  caseStudies?: string | null
  testimonials?: string | null
  otherComments?: string | null
  responses?: Array<{ label: string; value: string }> | null
}

const MATCH_LABELS: Record<ReportFieldsData['matchMethod'], string> = {
  external_id: 'Automatic (application reference)',
  manual: 'Manual (review queue)',
  import: 'Imported',
}

function fmtAmount(v: string | null | undefined) {
  return v != null && v !== '' ? `£${Math.round(parseFloat(v)).toLocaleString('en-GB')}` : null
}

export function ReportFields({ report }: { report: ReportFieldsData }) {
  const detailRows: FieldRow[] = [
    { label: 'Received', value: fmtDate(report.submittedAt) },
    { label: 'Matched to grant', value: MATCH_LABELS[report.matchMethod] },
    { label: 'Application ref', value: report.externalApplicationId ?? null },
    { label: 'Charity number', value: report.charityNumber ?? null },
    { label: 'Company number', value: report.companyNumber ?? null },
    { label: 'Amount stated', value: fmtAmount(report.amountAwarded) },
    {
      label: 'Beneficiaries stated',
      value:
        report.beneficiaryCount != null ? report.beneficiaryCount.toLocaleString('en-GB') : null,
    },
    { label: 'Award date stated', value: report.awardDate ?? null },
    { label: 'Award end stated', value: report.awardEndDate ?? null },
    { label: 'Delivery area', value: report.deliveryArea ?? null },
  ].filter((r) => r.value)

  const contactRows: FieldRow[] = [
    { label: 'Contact name', value: report.contactName ?? null },
    { label: 'Contact email', value: report.contactEmail ?? null },
    { label: 'Contact phone', value: report.contactPhone ?? null },
  ].filter((r) => r.value)

  const narratives = (
    [
      ['Grant / funding title', report.grantTitle],
      ['Grant purpose', report.grantPurpose],
      ['Impact summary', report.impactSummary],
      ['Challenges', report.challenges],
      ['Lessons learned', report.lessons],
      ['Case studies', report.caseStudies],
      ['Testimonials', report.testimonials],
      ['Other comments', report.otherComments],
    ] as Array<[string, string | null | undefined]>
  ).filter((entry): entry is [string, string] => Boolean(entry[1]))

  const responses = report.responses ?? []

  return (
    <div className="flex flex-col gap-6">
      <Section title="Report details">
        <KeyValueCard rows={detailRows} />
      </Section>

      {contactRows.length > 0 && (
        <Section title="Contact">
          <KeyValueCard rows={contactRows} />
        </Section>
      )}

      <Section title="Report content">
        <dl className="flex flex-col gap-5">
          {narratives.map(([label, value]) => (
            <div key={label}>
              <dt className="mb-1 font-display text-label font-medium" style={{ color: C.sub }}>
                {label}
              </dt>
              <dd
                className="whitespace-pre-wrap font-display text-body leading-relaxed"
                style={{ color: C.body }}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      {responses.length > 0 && (
        <Section title="Further answers">
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
        </Section>
      )}
    </div>
  )
}
