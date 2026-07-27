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
