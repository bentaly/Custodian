import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { getAuth } from '../auth'
import { getAuthUser } from '../session'
import { claimPendingInvite } from '../invites'

export const getSession = createServerFn({ method: 'GET' }).handler(async () => {
  const request = getRequest()
  const session = await getAuth().api.getSession({ headers: request.headers })
  return session
})

export const getMe = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await getAuthUser()
  if (!user) return null

  // A signed-in user with no tenant (e.g. invited via Google OAuth, which never
  // hits completeRegistration) is auto-attached if a pending invite matches their
  // email. Superadmins legitimately have no clientId, so skip them.
  if (!user.clientId && user.role !== 'superadmin') {
    const claimed = await claimPendingInvite(user)
    if (claimed) return { ...user, clientId: claimed.clientId, role: claimed.role }
  }

  return user
})
