import { Dialog } from './ui'
import { C } from './ui/tokens'
import { Note } from './ApplicationSubmissionDialog'
import { ReportFields, type ReportFieldsData } from './ReportFields'
import { REPORT_CANONICAL_FIELD_BY_KEY } from '../lib/fieldMapping'
import { fmtDate } from '../lib/format'
import type { ReportAsSent } from '../server/reports/asSent'

// View Report: what the grantee sent, exactly as it arrived. The twin of an
// application's View Submission: every answer in their wording and their order, from
// the stored submission, with a note in blue beneath the one answer Custodian can read
// differently, the impact figure (corrected by hand, or not readable as a number).
//
// A report with no stored submission was never a form, so its fields are shown from
// the report's own columns instead, as before.

const MATCHED_HOW: Record<ReportFieldsData['matchMethod'], string> = {
  external_id: 'matched to this grant automatically, by the application reference',
  charity_number: 'matched to this grant automatically, by charity number',
  manual: 'placed on this grant by hand',
  import: 'brought in by the data import',
}

const fieldLabel = (key: string) =>
  REPORT_CANONICAL_FIELD_BY_KEY[key as keyof typeof REPORT_CANONICAL_FIELD_BY_KEY]?.label ?? key

export function ReportSubmissionDialog({
  open,
  onClose,
  description,
  fields,
  asSent,
  figure,
}: {
  open: boolean
  onClose: () => void
  /** "Riverbank Youth Trust · Final report" */
  description: string
  fields: ReportFieldsData
  asSent: ReportAsSent | null
  /** The figure the report is counted at, and where it came from. */
  figure: { quantity: number | null; source: string | null; unit: string | null }
}) {
  const unit = figure.unit ? ` ${figure.unit.charAt(0).toLowerCase()}${figure.unit.slice(1)}` : ''
  const corrected = figure.source === 'edited'
  const figureNote = corrected ? (
    <Note tag="Changed">
      Custodian uses{' '}
      <b>
        {figure.quantity != null
          ? `${figure.quantity.toLocaleString('en-GB')}${unit}`
          : 'no figure'}
      </b>{' '}
      · corrected by hand
    </Note>
  ) : asSent?.unreadFigure ? (
    <Note tag="Not read">
      Custodian could not read this as a number
      {figure.quantity != null
        ? `, so the figure is ${figure.quantity.toLocaleString('en-GB')}${unit}, read from the report itself`
        : ', so the report has no figure yet'}
    </Note>
  ) : null

  return (
    <Dialog open={open} onClose={onClose} title="Report form" description={description} size="lg">
      {asSent ? (
        <>
          <p
            className="mb-4 rounded-chip px-3 py-2.5 font-display text-label"
            style={{ backgroundColor: C.wash, color: C.body }}
          >
            Exactly as received on {fmtDate(fields.submittedAt)}, and{' '}
            {MATCHED_HOW[fields.matchMethod]}.
          </p>
          <dl className="flex flex-col">
            {asSent.answers.map((a, i) => (
              <div
                key={`${a.label}-${i}`}
                className={i > 0 ? 'mt-4 border-t pt-4 pb-1' : 'pb-1'}
                style={i > 0 ? { borderColor: C.line } : undefined}
              >
                <dt className="mb-1.5 font-display text-label font-medium" style={{ color: C.sub }}>
                  {/* A payload that named a field by OUR key ("impactSummary") gets our
                      label for it; a form's own question is shown as they wrote it. */}
                  {a.label === a.canonical ? fieldLabel(a.label) : a.label}
                </dt>
                <dd>
                  <p
                    className="whitespace-pre-line break-words font-display text-body"
                    style={{ color: C.ink }}
                  >
                    {a.value}
                  </p>
                  {a.canonical === 'beneficiaryCount' && figureNote}
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <ReportFields report={fields} />
      )}
    </Dialog>
  )
}
