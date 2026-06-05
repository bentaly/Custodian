import { Resend } from 'resend'

const resend = new Resend(process.env['RESEND_API_KEY'])

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
  const from = process.env['FROM_EMAIL'] ?? 'Custodian <onboarding@resend.dev>'
  await resend.emails.send({
    from,
    to,
    subject: `You've been invited to join ${clientName} on Custodian`,
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
