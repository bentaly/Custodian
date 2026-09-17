// Text AND HTML, for the reason spelled out on the digests: HTML-only mail scores as
// spammy at Outlook/Hotmail, and literal hex throughout because no email client resolves
// CSS custom properties. Values are the Figma tokens from globals.css.
import { fmtDate, fmtMoney } from '../format'
import { escapeHtml } from '../html'
import {
  awardNotificationTotal,
  type AwardNotificationItem,
  type AwardNotificationModel,
} from './types'

const INK = '#141C24'
const MUTED = '#637083'
const FAINT = '#97A1AF'
const RULE = '#E3E8EF'

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

/**
 * Leads with the count and the money, in that order.
 *
 * The count is what makes it scannable in a list of subject lines ("4 grants" is a
 * board meeting, "1 grant" is a one-off), and the total is what an admin checks it
 * against. A single grant names the charity instead, because at n=1 the organisation is
 * more use than the arithmetic.
 */
export function awardNotificationSubject(model: AwardNotificationModel): string {
  const n = model.items.length
  const total = fmtMoney(awardNotificationTotal(model.items))
  if (n === 1) {
    return `${model.items[0]!.organisationName} set up: ${total}`
  }
  return `${n} new grants set up at ${model.clientName}: ${total}`
}

function itemLine(item: AwardNotificationItem): string {
  const where = item.programmeName ? ` · ${item.programmeName}` : ''
  const starts = item.startDate ? `  starts ${fmtDate(item.startDate)}` : ''
  return `${fmtMoney(item.amount)}  ${item.organisationName}${where}${starts}`
}

export function awardNotificationText(model: AwardNotificationModel): string {
  const n = model.items.length
  const lines: string[] = [
    `${model.clientName}: ${n} new ${plural(n, 'grant', 'grants')} set up`,
    `${fmtMoney(awardNotificationTotal(model.items))} in total`,
    ``,
  ]
  for (const item of model.items) lines.push(`  ${itemLine(item)}`)
  lines.push(
    ``,
    `See the awards register:`,
    model.awardsUrl,
    ``,
    `You are receiving this because new grant alerts are on for your account.`,
    `Turn them off: ${model.unsubscribeUrl}`,
  )
  return lines.join('\n')
}

function rowsHtml(items: AwardNotificationItem[]): string {
  return items
    .map(
      (item) => `
        <tr>
          <td style="padding:10px 12px 10px 0;border-bottom:1px solid ${RULE};
                     color:${INK};font-size:14px;vertical-align:top;">
            <strong style="font-weight:600;">${escapeHtml(item.organisationName)}</strong>
            ${item.programmeName ? `<br><span style="color:${FAINT};font-size:12px;">${escapeHtml(item.programmeName)}</span>` : ''}
            ${item.startDate ? `<br><span style="color:${FAINT};font-size:12px;">Starts ${escapeHtml(fmtDate(item.startDate))}</span>` : ''}
          </td>
          <td style="padding:10px 0;border-bottom:1px solid ${RULE};text-align:right;
                     white-space:nowrap;color:${INK};font-size:14px;font-weight:600;vertical-align:top;">
            ${escapeHtml(fmtMoney(item.amount))}
          </td>
        </tr>`,
    )
    .join('')
}

export function awardNotificationHtml(model: AwardNotificationModel): string {
  const n = model.items.length
  return `
    <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="font-size:20px;font-weight:600;color:${INK};margin:0 0 4px;">
        ${n} new ${plural(n, 'grant', 'grants')} set up
      </h2>
      <p style="color:${MUTED};font-size:14px;margin:0 0 20px;">
        ${escapeHtml(model.clientName)} · ${escapeHtml(fmtMoney(awardNotificationTotal(model.items)))} in total
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        ${rowsHtml(model.items)}
      </table>
      <p style="margin:28px 0 0;">
        <a href="${escapeHtml(model.awardsUrl)}"
           style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;
                  padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;">
          Open the awards register
        </a>
      </p>
      <p style="color:${FAINT};font-size:12px;line-height:1.5;margin:28px 0 0;
                border-top:1px solid ${RULE};padding-top:16px;">
        You are receiving this because new grant alerts are on for your account.
        <a href="${escapeHtml(model.unsubscribeUrl)}" style="color:${FAINT};">Turn them off</a>.
      </p>
    </div>
  `
}

export function renderAwardNotification(model: AwardNotificationModel): {
  subject: string
  text: string
  html: string
} {
  return {
    subject: awardNotificationSubject(model),
    text: awardNotificationText(model),
    html: awardNotificationHtml(model),
  }
}
