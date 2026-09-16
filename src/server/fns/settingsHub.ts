import { createServerFn } from '@tanstack/react-start'
import { requireAuthUser } from '../session'
import { settingsStatusesFor } from '../settingsHub'
import type { SettingsStatuses } from '../../lib/settingsStatus'

/** The Settings hub's status lines, for the caller's own foundation. */
export const getSettingsStatuses = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SettingsStatuses> => {
    const user = await requireAuthUser()
    // A superadmin with no client has no foundation to describe.
    if (!user.clientId) return {}
    return settingsStatusesFor(user.clientId, user.role)
  },
)
