import { z } from 'zod'

export const CreateInvitationSchema = z.object({
  email: z.string().email(),
  // `superadmin` is deliberately absent — platform roles are not invitable.
  role: z.enum(['admin', 'trustee', 'finance']),
})
