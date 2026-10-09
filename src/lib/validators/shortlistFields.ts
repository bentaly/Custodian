import { z } from 'zod'

/**
 * What "Shortlist" asks beyond the amount, for a partnership or an EOI taken straight
 * to the shortlist without an application form. All optional on the wire: absent keeps
 * what was logged, so an older client (or a partnership whose fields are already right)
 * sends only the amount. No new columns: each lands on an application column that a
 * form-submitted application fills too.
 */
export const SHORTLIST_FIELDS = {
  /** This financial year's share; null = the suggestion (amount ÷ grant duration). */
  firstYearAmount: z.number().min(0).max(1_000_000_000).nullable().optional(),
  purpose: z.string().trim().min(1, 'Say what the grant would be for').max(4000).optional(),
  deliveryArea: z.string().trim().max(255).nullable().optional(),
  /** Kept as text, as the column is: a count in the programme's impact unit. */
  proposedImpactQuantity: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, 'Enter the impact as a number')
    .nullable()
    .optional(),
  unrestrictedReserves: z.number().min(0).max(100_000_000_000).nullable().optional(),
  contactEmail: z.email('Enter a valid email address').max(255).nullable().optional(),
}
