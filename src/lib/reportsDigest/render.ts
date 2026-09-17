// Rendered to text AND HTML, for the reason spelled out on the payments digest's
// renderer: HTML-only mail scores as spammy at Outlook/Hotmail, and a chase list that
// lands in junk is worse than none, because the recipient believes nothing is due.
//
// Literal hex throughout, never `var(--color-*)` — no email client resolves CSS custom
// properties. Values copied from the Figma tokens in globals.css.
import { fmtDate } from '../format'
import { escapeHtml } from '../html'
import { addDaysIso } from '../schedule'
import type { ReportDigestItem, ReportDigestModel } from './types'

const INK = '#141C24'
const MUTED = '#637083'
const FAINT = '#97A1AF'
const BODY = '#344051'
const RULE = '#E3E8EF'
const DANGER = '#d32626'

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

/**
 * The subject line leads with the count, and calls out late reports separately.
 *
 * Where the payments digest leads with money, this one leads with a number of reports:
 * there is no sum to quote, and "3 reports overdue" is the fact that decides whether the
 * email is opened this morning or after lunch. Late is named first because it is the
 * half that has already gone wrong.
 */
export function reportDigestSubject(model: ReportDigestModel): string {
  const due = model.dueThisWeek.length
  const late = model.overdue.length
  if (late > 0 && due > 0) {
    return `${late} ${plural(late, 'report', 'reports')} overdue, ${due} due this week`
  }
  if (late > 0) {
    return `${late} ${plural(late, 'report', 'reports')} overdue at ${model.clientName}`
  }
  return `${due} ${plural(due, 'report', 'reports')} due this week at ${model.clientName}`
}

function lateNote(item: ReportDigestItem): string {
  if (item.daysLate <= 0) return ''
  return item.daysLate === 1 ? '1 day late' : `${item.daysLate} days late`
}

function itemLine(item: ReportDigestItem): string {
  const where = item.programmeName ? ` · ${item.programmeName}` : ''
  const late = lateNote(item)
  return `${fmtDate(item.dueDate)}  ${item.organisationName}${where}  ${item.label}${late ? `  (${late})` : ''}`
}

export function reportDigestText(model: ReportDigestModel): string {
  const weekEnd = addDaysIso(model.weekOf, 6)
  const lines: string[] = [
    `${model.clientName}: reports expected`,
    `Week of ${fmtDate(model.weekOf)} to ${fmtDate(weekEnd)}`,
    ``,
  ]
  // Overdue first, always. A chase list ordered by date puts Friday's report above the
  // one that was due in March, which is the wrong way round for a list of things to do.
  if (model.overdue.length > 0) {
    lines.push(
      `OVERDUE: ${model.overdue.length} ${plural(model.overdue.length, 'report', 'reports')}`,
    )
    for (const item of model.overdue) lines.push(`  ${itemLine(item)}`)
    lines.push(``)
  }
  if (model.dueThisWeek.length > 0) {
    lines.push(
      `DUE THIS WEEK: ${model.dueThisWeek.length} ${plural(model.dueThisWeek.length, 'report', 'reports')}`,
    )
    for (const item of model.dueThisWeek) lines.push(`  ${itemLine(item)}`)
    lines.push(``)
  }
  lines.push(
    `See everything outstanding:`,
    model.reportsUrl,
    ``,
    `You are receiving this because weekly report reminders are on for your account.`,
    `Turn them off: ${model.unsubscribeUrl}`,
  )
  return lines.join('\n')
}

function rowsHtml(items: ReportDigestItem[], accent: string): string {
  return items
    .map((item) => {
      const late = lateNote(item)
      return `
        <tr>
          <td style="padding:10px 12px 10px 0;border-bottom:1px solid ${RULE};white-space:nowrap;
                     color:${accent};font-size:13px;vertical-align:top;">
            ${escapeHtml(fmtDate(item.dueDate))}
          </td>
          <td style="padding:10px 12px 10px 0;border-bottom:1px solid ${RULE};
                     color:${INK};font-size:14px;vertical-align:top;">
            <strong style="font-weight:600;">${escapeHtml(item.organisationName)}</strong>
            ${item.programmeName ? `<br><span style="color:${FAINT};font-size:12px;">${escapeHtml(item.programmeName)}</span>` : ''}
          </td>
          <td style="padding:10px 0;border-bottom:1px solid ${RULE};text-align:right;
                     color:${BODY};font-size:13px;vertical-align:top;">
            ${escapeHtml(item.label)}
            ${late ? `<br><span style="color:${DANGER};font-size:12px;">${escapeHtml(late)}</span>` : ''}
          </td>
        </tr>`
    })
    .join('')
}

function sectionHtml(title: string, items: ReportDigestItem[], accent: string): string {
  if (items.length === 0) return ''
  return `
    <p style="margin:24px 0 4px;font-size:12px;font-weight:600;letter-spacing:0.06em;
              text-transform:uppercase;color:${accent};">
      ${escapeHtml(title)}
    </p>
    <p style="margin:0 0 8px;color:${MUTED};font-size:13px;">
      ${items.length} ${plural(items.length, 'report', 'reports')}
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
      ${rowsHtml(items, accent)}
    </table>`
}

export function reportDigestHtml(model: ReportDigestModel): string {
  const weekEnd = addDaysIso(model.weekOf, 6)
  return `
    <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="font-size:20px;font-weight:600;color:${INK};margin:0 0 4px;">
        Reports expected
      </h2>
      <p style="color:${MUTED};font-size:14px;margin:0 0 4px;">
        ${escapeHtml(model.clientName)} · week of ${escapeHtml(fmtDate(model.weekOf))} to ${escapeHtml(fmtDate(weekEnd))}
      </p>
      ${sectionHtml('Overdue', model.overdue, DANGER)}
      ${sectionHtml('Due this week', model.dueThisWeek, BODY)}
      <p style="margin:28px 0 0;">
        <a href="${escapeHtml(model.reportsUrl)}"
           style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;
                  padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;">
          Open Reports
        </a>
      </p>
      <p style="color:${FAINT};font-size:12px;line-height:1.5;margin:28px 0 0;
                border-top:1px solid ${RULE};padding-top:16px;">
        You are receiving this because weekly report reminders are on for your account.
        <a href="${escapeHtml(model.unsubscribeUrl)}" style="color:${FAINT};">Turn them off</a>.
      </p>
    </div>
  `
}

export function renderReportDigest(model: ReportDigestModel): {
  subject: string
  text: string
  html: string
} {
  return {
    subject: reportDigestSubject(model),
    text: reportDigestText(model),
    html: reportDigestHtml(model),
  }
}
