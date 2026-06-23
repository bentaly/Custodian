import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuthUser } from '../session'
import { claimPendingInvite } from '../invites'

/**
 * Finalise a freshly-signed-up staff account by attaching it to a tenant via a
 * valid invitation. Self-serve tenant creation has been removed — onboarding is
 * invite-only — so this is the server-side gate: BetterAuth will still create the
 * auth user (emailAndPassword/Google), but without a valid invite they get no
 * `clientId` and are bounced to /no-access by the authenticated layout guard.
 */
export const completeRegistration = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ inviteToken: z.string().optional() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser()

    if (user.clientId) return user

    const claimed = await claimPendingInvite(user, data.inviteToken)
    if (!claimed) throw new Error('No valid invitation for this account')

    return { ...user, clientId: claimed.clientId, role: claimed.role }
  })
