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

/**
 * Resend reports API failures in the returned `{ error }` rather than throwing, so a
 * rejected send (bad domain, suppressed address, quota) otherwise looks identical to a
 * delivered one and vanishes silently. Callers are best-effort — a failed send must not
 * take down the invite/sign-in request — so log loudly and carry on.
 */
async function send(what: string, payload: Parameters<Resend['emails']['send']>[0]) {
  const resend = getResend()
  if (!resend) {
    console.warn(`RESEND_API_KEY not set — skipping ${what}`)
    return
  }
  const { error } = await resend.emails.send(payload)
  if (error) console.error(`Resend rejected ${what} to ${String(payload.to)}:`, error)
}

function fromAddress() {
  return process.env['FROM_EMAIL'] ?? 'Custodian <onboarding@resend.dev>'
}

export async function sendSignInCodeEmail({ to, otp }: { to: string; otp: string }) {
  await send('sign-in code email', {
    from: fromAddress(),
    to,
    subject: `${otp} is your Custodian sign-in code`,
    text: [
      `Your Custodian sign-in code is ${otp}`,
      ``,
      `Enter it on the sign-in page. It expires in 5 minutes.`,
      ``,
      `If you didn't try to sign in, you can safely ignore this email — nobody can`,
      `access your account without this code.`,
    ].join('\n'),
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="font-size: 20px; font-weight: 600; color: #111827; margin: 0 0 12px;">
          Your sign-in code
        </h2>
        <p style="color: #6b7280; font-size: 15px; line-height: 1.5; margin: 0 0 24px;">
          Enter this code on the sign-in page. It expires in 5 minutes.
        </p>
        <p style="font-size: 32px; font-weight: 600; letter-spacing: 6px; color: #111827;
                  margin: 0 0 24px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">
          ${otp}
        </p>
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">
          If you didn't try to sign in, you can safely ignore this email — nobody can access
          your account without this code.
        </p>
      </div>
    `,
  })
}

export async function sendPasswordResetCodeEmail({ to, otp }: { to: string; otp: string }) {
  await send('password reset email', {
    from: fromAddress(),
    to,
    subject: `${otp} is your Custodian password reset code`,
    text: [
      `Your Custodian password reset code is ${otp}`,
      ``,
      `Enter it on the password reset page to choose a new password.`,
      `It expires in 5 minutes.`,
      ``,
      `If you didn't ask to reset your password, you can safely ignore this email —`,
      `your password will not change.`,
    ].join('\n'),
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="font-size: 20px; font-weight: 600; color: #111827; margin: 0 0 12px;">
          Reset your password
        </h2>
        <p style="color: #6b7280; font-size: 15px; line-height: 1.5; margin: 0 0 24px;">
          Enter this code to choose a new password. It expires in 5 minutes.
        </p>
        <p style="font-size: 32px; font-weight: 600; letter-spacing: 6px; color: #111827;
                  margin: 0 0 24px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">
          ${otp}
        </p>
        <p style="color: #9ca3af; font-size: 13px; margin: 0;">
          If you didn't ask to reset your password, you can safely ignore this email — your
          password will not change.
        </p>
      </div>
    `,
  })
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
  await send('invitation email', {
    from: fromAddress(),
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
