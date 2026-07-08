import { Resend } from 'resend'

// Lazy + tolerant: `new Resend()` throws when RESEND_API_KEY is missing, and at
// module scope that crashes every importer (e.g. the invite endpoints) before any
// best-effort try/catch can run. Build it on first use and no-op without a key.
let _resend: Resend | null | undefined
function getResend(): Resend | null {
  if (_resend === undefined) {
    const key = process.env['RESEND_API_KEY']
    _resend = key ? new Resend(key) : null
  }
  return _resend
}

export async function sendInvitationEmail({
  to,
  inviteUrl,
  clientName,
  inviterName,
}: {
  to: string
  inviteUrl: string
  clientName: string
  inviterName: string
}) {
  const resend = getResend()
  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping invitation email')
    return
  }
  const from = process.env['FROM_EMAIL'] ?? 'Custodian <onboarding@resend.dev>'
  await resend.emails.send({
    from,
    to,
    subject: `You've been invited to join ${clientName} on Custodian`,
    // Plain-text alternative sent alongside the HTML (multipart/alternative). Modern
    // clients render the HTML; the text part is a fallback and, importantly, a
    // deliverability signal — HTML-only mail scores as spammy (notably at Outlook/Hotmail).
    text: [
      `You've been invited to Custodian.`,
      ``,
      `${inviterName} has invited you to join ${clientName}.`,
      `This invitation expires in 7 days.`,
      ``,
      `Accept your invitation:`,
      inviteUrl,
      ``,
      `If you weren't expecting this invitation, you can safely ignore this email.`,
    ].join('\n'),
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="font-size: 20px; font-weight: 600; color: #111827; margin: 0 0 12px;">
          You've been invited to Custodian
        </h2>
        <p style="color: #6b7280; font-size: 15px; line-height: 1.5; margin: 0 0 8px;">
          ${inviterName} has invited you to join <strong style="color: #111827;">${clientName}</strong>.
        </p>
        <p style="color: #6b7280; font-size: 15px; line-height: 1.5; margin: 0 0 24px;">
          Click the button below to create your account. This invitation expires in 7 days.
        </p>
        <a href="${inviteUrl}"
           style="display: inline-block; background: #111827; color: #fff; font-size: 14px;
                  font-weight: 500; padding: 10px 20px; border-radius: 6px; text-decoration: none;">
          Accept invitation
        </a>
        <p style="color: #9ca3af; font-size: 13px; margin: 24px 0 0;">
          If you weren't expecting this invitation, you can safely ignore this email.
        </p>
      </div>
    `,
  })
}
