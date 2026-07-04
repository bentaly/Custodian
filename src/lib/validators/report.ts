import { z } from 'zod'

// The canonical input for creating a report submission, validated at promotion
// time (after mapping + grant matching). Mirrors CreateApplicationSchema's role
// for applications. `externalApplicationId` is required-to-flow in the pipeline
// (it drives auto-matching) but optional HERE because an admin can resolve a
// held report by picking the grant manually — the link, not the ID, is what a
// submission actually needs.
export const CreateReportSubmissionSchema = z.object({
  externalApplicationId: z.string().optional(),
  organisationName: z.string().min(1),
  impactSummary: z.string().min(1),
  charityNumber: z.string().optional(),
  companyNumber: z.string().optional(),
  programmeName: z.string().optional(),
  amountAwarded: z.number().positive().optional(),
  awardDate: z.string().optional(),
  awardEndDate: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().optional(),
  contactPhone: z.string().optional(),
  grantTitle: z.string().optional(),
  grantPurpose: z.string().optional(),
  challenges: z.string().optional(),
  lessons: z.string().optional(),
  caseStudies: z.string().optional(),
  testimonials: z.string().optional(),
  otherComments: z.string().optional(),
  beneficiaryCount: z.number().int().nonnegative().optional(),
  deliveryArea: z.string().optional(),
  responses: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
})
export type CreateReportSubmissionInput = z.infer<typeof CreateReportSubmissionSchema>
