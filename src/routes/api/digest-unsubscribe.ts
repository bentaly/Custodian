// The off switch in the digest footer. A GET, because it is a link in an email — which
// means a scanning proxy may fetch it, so it presents a confirmation page and the
// actual write happens on POST from that page's form. An unsubscribe that fires on a
// preflight fetch is one that turns itself off in a corporate mailbox.
import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { getDb } from '../../server/db'
import { users } from '../../../drizzle/schema'
import { unsubscribeTokenValid } from '../../server/financeDigest/unsubscribe'
import { escapeHtml } from '../../lib/html'

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${escapeHtml(title)}</title>
     <div style="font-family:sans-serif;max-width:420px;margin:15vh auto;padding:24px;text-align:center;">
       ${body}
     </div>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

const NOT_VALID = () =>
  page(
    'Link not valid',
    `<h1 style="font-size:20px;color:#141C24;">This link is not valid</h1>
     <p style="color:#637083;font-size:15px;line-height:1.5;">
       You can change email preferences from your profile in Custodian.
     </p>`,
    400,
  )

export const Route = createFileRoute('/api/digest-unsubscribe')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const url = new URL(request.url)
        const userId = url.searchParams.get('u') ?? ''
        const token = url.searchParams.get('t') ?? ''
        if (!userId || !token || !(await unsubscribeTokenValid(userId, token))) return NOT_VALID()

        return page(
          'Turn off payment reminders',
          `<h1 style="font-size:20px;color:#141C24;">Turn off weekly payment reminders?</h1>
           <p style="color:#637083;font-size:15px;line-height:1.5;">
             You will stop receiving the Monday email listing payments due. Award letters and
             other Custodian email are not affected.
           </p>
           <form method="post">
             <button type="submit"
               style="background:#141C24;color:#fff;border:0;border-radius:8px;padding:10px 18px;
                      font-size:14px;font-weight:600;cursor:pointer;">
               Turn them off
             </button>
           </form>`,
        )
      },

      POST: async ({ request }: { request: Request }) => {
        const url = new URL(request.url)
        const userId = url.searchParams.get('u') ?? ''
        const token = url.searchParams.get('t') ?? ''
        if (!userId || !token || !(await unsubscribeTokenValid(userId, token))) return NOT_VALID()

        // An explicit `false`, never NULL. NULL means "has never chosen" and would put
        // them straight back on the role default — i.e. resubscribe them.
        await getDb().update(users).set({ weeklyFinanceDigest: false }).where(eq(users.id, userId))

        return page(
          'Reminders turned off',
          `<h1 style="font-size:20px;color:#141C24;">Turned off</h1>
           <p style="color:#637083;font-size:15px;line-height:1.5;">
             You will no longer receive the weekly payments email. You can turn it back on
             from your profile in Custodian.
           </p>`,
        )
      },
    },
  },
} as any)
