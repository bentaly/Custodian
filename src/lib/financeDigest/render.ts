// Rendered to text AND HTML. The text part is not a courtesy: HTML-only mail scores as
// spammy at Outlook/Hotmail (see the note on `sendInvitationEmail`), and a payments
// digest that lands in junk is worse than no digest, because the recipient believes
// they have been told there is nothing due.
//
// Literal hex throughout, never `var(--color-*)` — no email client resolves CSS custom
// properties. Values copied from the Figma tokens in globals.css; if a token moves,
// move it here too.
import { fmtDate, fmtMoney } from '../format'
import { escapeHtml } from '../html'
import { addDaysIso } from '../schedule'
import { digestTotal, type DigestItem, type DigestModel } from './types'

const INK = '#141C24'
const MUTED = '#637083'
const FAINT = '#97A1AF'
const BODY = '#344051'
const RULE = '#E3E8EF'
const DANGER = '#d32626'

/**
 * The subject line leads with the money, because it is read in a list of forty other
 * subject lines and "Payments due this week" tells a finance officer nothing they
 * cannot guess. Overdue money is called out separately — it is the half that has
 * already gone wrong.
 */
export function digestSubject(model: DigestModel): string {
  const dueTotal = digestTotal(model.dueThisWeek)
  const overdueTotal = digestTotal(model.overdue)
  if (model.overdue.length > 0 && model.dueThisWeek.length > 0) {
    return `${fmtMoney(dueTotal)} due this week, ${fmtMoney(overdueTotal)} overdue`
  }
  if (model.overdue.length > 0) {
    return `${fmtMoney(overdueTotal)} overdue — ${model.clientName} payments`
  }
  return `${fmtMoney(dueTotal)} due this week — ${model.clientName} payments`
}

function itemLine(item: DigestItem): string {
  const where = item.programmeName ? ` · ${item.programmeName}` : ''
  const flag = item.bankFlagged ? ' · bank details need checking' : ''
  return `${fmtDate(item.dueDate)}  ${fmtMoney(item.amount)}  ${item.organisationName}${where}${flag}`
}

export function digestText(model: DigestModel): string {
  const weekEnd = addDaysIso(model.weekOf, 6)
  const lines: string[] = [
    `${model.clientName} — payments due`,
    `Week of ${fmtDate(model.weekOf)} to ${fmtDate(weekEnd)}`,
    ``,
  ]
  // Overdue first, always. A digest that opens with Friday's payment and buries the one
  // missed a fortnight ago has ordered itself by date instead of by urgency.
  if (model.overdue.length > 0) {
    lines.push(
      `OVERDUE — ${fmtMoney(digestTotal(model.overdue))} across ${model.overdue.length} payment${model.overdue.length === 1 ? '' : 's'}`,
    )
    for (const item of model.overdue) lines.push(`  ${itemLine(item)}`)
    lines.push(``)
  }
  if (model.dueThisWeek.length > 0) {
    lines.push(
      `DUE THIS WEEK — ${fmtMoney(digestTotal(model.dueThisWeek))} across ${model.dueThisWeek.length} payment${model.dueThisWeek.length === 1 ? '' : 's'}`,
    )
    for (const item of model.dueThisWeek) lines.push(`  ${itemLine(item)}`)
    lines.push(``)
  }
  lines.push(
    `See the full payment schedule:`,
    model.financeUrl,
    ``,
    `You are receiving this because weekly payment reminders are on for your account.`,
    `Turn them off: ${model.unsubscribeUrl}`,
  )
  return lines.join('\n')
}

function rowsHtml(items: DigestItem[], accent: string): string {
  return items
    .map(
      (item) => `
        <tr>
          <td style="padding:10px 12px 10px 0;border-bottom:1px solid ${RULE};white-space:nowrap;
                     color:${accent};font-size:13px;vertical-align:top;">
            ${escapeHtml(fmtDate(item.dueDate))}
          </td>
          <td style="padding:10px 12px 10px 0;border-bottom:1px solid ${RULE};
                     color:${INK};font-size:14px;vertical-align:top;">
            <strong style="font-weight:600;">${escapeHtml(item.organisationName)}</strong>
            ${item.programmeName ? `<br><span style="color:${FAINT};font-size:12px;">${escapeHtml(item.programmeName)}</span>` : ''}
            ${item.bankFlagged ? `<br><span style="color:${DANGER};font-size:12px;">Bank details need checking</span>` : ''}
          </td>
          <td style="padding:10px 0;border-bottom:1px solid ${RULE};text-align:right;
                     white-space:nowrap;color:${INK};font-size:14px;font-weight:600;vertical-align:top;">
            ${escapeHtml(fmtMoney(item.amount))}
          </td>
        </tr>`,
    )
    .join('')
}

function sectionHtml(title: string, items: DigestItem[], accent: string): string {
  if (items.length === 0) return ''
  return `
    <p style="margin:24px 0 4px;font-size:12px;font-weight:600;letter-spacing:0.06em;
              text-transform:uppercase;color:${accent};">
      ${escapeHtml(title)}
    </p>
    <p style="margin:0 0 8px;color:${MUTED};font-size:13px;">
      ${escapeHtml(fmtMoney(digestTotal(items)))} across ${items.length} payment${items.length === 1 ? '' : 's'}
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
      ${rowsHtml(items, accent)}
    </table>`
}

export function digestHtml(model: DigestModel): string {
  const weekEnd = addDaysIso(model.weekOf, 6)
  return `
    <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="font-size:20px;font-weight:600;color:${INK};margin:0 0 4px;">
        Payments due
      </h2>
      <p style="color:${MUTED};font-size:14px;margin:0 0 4px;">
        ${escapeHtml(model.clientName)} · week of ${escapeHtml(fmtDate(model.weekOf))} to ${escapeHtml(fmtDate(weekEnd))}
      </p>
      ${sectionHtml('Overdue', model.overdue, DANGER)}
      ${sectionHtml('Due this week', model.dueThisWeek, BODY)}
      <p style="margin:28px 0 0;">
        <a href="${escapeHtml(model.financeUrl)}"
           style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;
                  padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;">
          Open the payment schedule
        </a>
      </p>
      <p style="color:${FAINT};font-size:12px;line-height:1.5;margin:28px 0 0;
                border-top:1px solid ${RULE};padding-top:16px;">
        You are receiving this because weekly payment reminders are on for your account.
        <a href="${escapeHtml(model.unsubscribeUrl)}" style="color:${FAINT};">Turn them off</a>.
      </p>
    </div>
  `
}

export function renderDigest(model: DigestModel): { subject: string; text: string; html: string } {
  return {
    subject: digestSubject(model),
    text: digestText(model),
    html: digestHtml(model),
  }
}
