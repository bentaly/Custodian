// Email HTML carries LITERAL hex, never `var(--color-*)`: no email client resolves CSS
// custom properties, and an unresolved var renders as no colour at all. The values below
// are the Figma tokens copied by hand — if a token changes, change them here too.
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

/** The bare `local@domain` out of a possibly `Name <local@domain>` From setting. */
function fromMailbox(): string {
  const configured = fromAddress()
  const angled = configured.match(/<([^>]+)>/)
  return (angled?.[1] ?? configured).trim()
}

/**
 * A From header that reads as the foundation: their name in the display part, our
 * verified sending mailbox behind it.
 *
 * We cannot put the foundation's own address in From. SPF/DKIM/DMARC alignment is
 * checked against the From domain, so sending as `grants@theirfoundation.org` from our
 * infrastructure would fail authentication and land in spam — the deliverability cost
 * is worse than the branding gain. Making it genuinely come *from* their domain needs
 * them to add DNS records for a verified sending domain, which is a separate feature.
 * Until then: their name in From, their address in Reply-To (see `sendAwardLetterEmail`).
 */
function brandedFrom(displayName: string | null | undefined): string {
  const name = displayName?.trim()
  if (!name) return fromAddress()
  // Quote the display name and strip the characters that would let it break out of the
  // header — a client-supplied foundation name reaches this string.
  const safe = name.replace(/["\\\r\n]/g, '').slice(0, 78)
  return `"${safe}" <${fromMailbox()}>`
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
        <h2 style="font-size: 20px; font-weight: 600; color: #141C24; margin: 0 0 12px;">
          Your sign-in code
        </h2>
        <p style="color: #637083; font-size: 15px; line-height: 1.5; margin: 0 0 24px;">
          Enter this code on the sign-in page. It expires in 5 minutes.
        </p>
        <p style="font-size: 32px; font-weight: 600; letter-spacing: 6px; color: #141C24;
                  margin: 0 0 24px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">
          ${otp}
        </p>
        <p style="color: #97A1AF; font-size: 13px; margin: 0;">
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
        <h2 style="font-size: 20px; font-weight: 600; color: #141C24; margin: 0 0 12px;">
          Reset your password
        </h2>
        <p style="color: #637083; font-size: 15px; line-height: 1.5; margin: 0 0 24px;">
          Enter this code to choose a new password. It expires in 5 minutes.
        </p>
        <p style="font-size: 32px; font-weight: 600; letter-spacing: 6px; color: #141C24;
                  margin: 0 0 24px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">
          ${otp}
        </p>
        <p style="color: #97A1AF; font-size: 13px; margin: 0;">
          If you didn't ask to reset your password, you can safely ignore this email — your
          password will not change.
        </p>
      </div>
    `,
  })
}

/**
 * Email an award letter to a grantee.
 *
 * Unlike the other senders this one REPORTS its outcome rather than swallowing it. The
 * others are best-effort side-cars to a request the user is watching (an invite, a
 * sign-in code) and a failure is recoverable by retrying the action. An award letter is
 * a contractual notification sent in the background after the award is already
 * committed, so a silent failure would leave a charity un-notified with nothing on
 * screen to say so. The caller records the result on `award_letters.status` and the
 * award detail screen offers a resend.
 */
export async function sendAwardLetterEmail({
  to,
  replyTo,
  senderName,
  subject,
  html,
  text,
}: {
  to: string
  replyTo?: string | null
  senderName?: string | null
  subject: string
  html: string
  text: string
}): Promise<{ ok: boolean; error?: string }> {
  const resend = getResend()
  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping award letter email')
    return { ok: false, error: 'Email is not configured (no RESEND_API_KEY).' }
  }
  const { error } = await resend.emails.send({
    from: brandedFrom(senderName),
    to,
    ...(replyTo ? { replyTo } : {}),
    subject,
    text,
    html,
  })
  if (error) {
    console.error(`Resend rejected award letter to ${to}:`, error)
    return { ok: false, error: error.message ?? 'The email provider rejected the message.' }
  }
  return { ok: true }
}

/**
 * The weekly payments digest. Returns a result rather than swallowing the error, like
 * `sendAwardLetterEmail` and unlike the fire-and-forget helpers above: the caller
 * records a receipt only on success, and a user with no receipt is retried by the next
 * run. A silent failure here would mean a finance officer believing there is nothing
 * due when there is.
 */
export async function sendFinanceDigestEmail({
  to,
  subject,
  text,
  html,
}: {
  to: string
  subject: string
  text: string
  html: string
}): Promise<{ ok: boolean; error?: string }> {
  const resend = getResend()
  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping finance digest email')
    return { ok: false, error: 'Email is not configured (no RESEND_API_KEY).' }
  }
  const { error } = await resend.emails.send({ from: fromAddress(), to, subject, text, html })
  if (error) {
    console.error(`Resend rejected finance digest to ${to}:`, error)
    return { ok: false, error: error.message ?? 'The email provider rejected the message.' }
  }
  return { ok: true }
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
        <h2 style="font-size: 20px; font-weight: 600; color: #141C24; margin: 0 0 12px;">
          You've been invited to Custodian
        </h2>
        <p style="color: #637083; font-size: 15px; line-height: 1.5; margin: 0 0 8px;">
          ${inviterName} has invited you to join <strong style="color: #141C24;">${clientName}</strong>.
        </p>
        <p style="color: #637083; font-size: 15px; line-height: 1.5; margin: 0 0 24px;">
          Click the button below to create your account. This invitation expires in 7 days.
        </p>
        <a href="${inviteUrl}"
           style="display: inline-block; background: #141C24; color: #fff; font-size: 14px;
                  font-weight: 500; padding: 10px 20px; border-radius: 6px; text-decoration: none;">
          Accept invitation
        </a>
        <p style="color: #97A1AF; font-size: 13px; margin: 24px 0 0;">
          If you weren't expecting this invitation, you can safely ignore this email.
        </p>
      </div>
    `,
  })
}
