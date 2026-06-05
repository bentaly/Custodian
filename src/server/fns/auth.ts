import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { auth } from '../auth'
import { getAuthUser } from '../session'

export const getSession = createServerFn({ method: 'GET' }).handler(async () => {
  const request = getRequest()
  const session = await auth.api.getSession({ headers: request.headers })
  return session
})

export const getMe = createServerFn({ method: 'GET' }).handler(async () => {
  return getAuthUser()
})
