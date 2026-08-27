/**
 * Role display labels and the invitable subset.
 *
 * `superadmin` is platform-level and deliberately absent from INVITABLE_ROLES — a
 * foundation can never mint one. The hints double as the roles-and-permissions
 * explainer, which is why they live next to where a role is actually assigned
 * rather than on a settings page of their own.
 */
export const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  trustee: 'Trustee',
  finance: 'Finance',
}

export const INVITABLE_ROLES = [
  {
    value: 'admin',
    label: 'Admin',
    hint: 'Full access — rounds, programmes, grant decisions and payments.',
  },
  {
    value: 'trustee',
    label: 'Trustee',
    hint: 'Reads applications, comments and votes. Changes nothing.',
  },
  {
    value: 'finance',
    label: 'Finance',
    hint: 'Trustee access, plus the payment schedule — editing instalments and marking them paid.',
  },
] as const

export type InviteRole = (typeof INVITABLE_ROLES)[number]['value']

/**
 * May this role see the payment schedule — and with it, a grantee's bank details?
 *
 * The line INVITABLE_ROLES already draws in words: a trustee "reads applications,
 * comments and votes", and finance is "trustee access, PLUS the payment schedule".
 * Until the 2026-08-27 audit that line existed only in the copy. `/finance` had no
 * route guard, the nav item was shown to everyone, and `listFinanceGrants` /
 * `getFinanceGrant` asked only for a signed-in user — so any trustee could open
 * Finance and read every grantee's full account number and sort code, or export the
 * lot to CSV. The write paths were gated correctly all along; only the reads were
 * missed, which is the easier half to forget because nothing visibly breaks.
 *
 * Used in three places that must agree: the nav (what is offered), the route guard
 * (what is reachable), and the server fns (what is actually returned). Only the last
 * is a security boundary — the other two exist so a trustee is never shown a door
 * that 403s.
 */
export function canSeePayments(role: string): boolean {
  return role === 'superadmin' || role === 'admin' || role === 'finance'
}
