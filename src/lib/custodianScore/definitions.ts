// ─── Custodian score: criteria registry ──────────────────────────────────────
//
// The single source of truth for what each scoring criterion means. The model
// is told to score each of these 1–10; the composite (0–100) is a weighted roll-up.
// The UI renders labels from here; the prompt builder injects `description` so the
// rubric the model sees and the rubric we display can never drift apart.

import type { CriterionKey } from './types'

export interface CriterionDefinition {
  label: string
  /**
   * Relative weight in the composite roll-up. Weights are normalised at
   * compute time, so they don't need to sum to any particular number — tune
   * these to change how much each criterion moves the headline score.
   */
  weight: number
  /** What this criterion measures — injected verbatim into the model's rubric. */
  description: string
}

/**
 * Order here is the order shown in the UI and described to the model. All six
 * criteria apply to every client for now (see prototype CLBL set); if family
 * offices later need a different set, branch on client type here.
 */
export const CRITERION_DEFINITIONS: Record<CriterionKey, CriterionDefinition> = {
  strategic_alignment: {
    label: 'Strategic alignment',
    weight: 3,
    description:
      "How well the proposed work fits the funder's mission and this programme's stated goal. The single most important criterion — work that does not advance the mission should score low here regardless of its other merits.",
  },
  community_need: {
    label: 'Community need',
    weight: 2,
    description:
      'The strength of evidence that there is a real, pressing need for this work among the intended beneficiaries, and that the applicant understands that need.',
  },
  track_record: {
    label: 'Track record',
    weight: 2,
    description:
      "The applicant's demonstrated capability to deliver: relevant experience, prior outcomes, organisational maturity, and credible delivery partners.",
  },
  budget_quality: {
    label: 'Budget quality',
    weight: 1.5,
    description:
      'Whether the budget is clear, itemised, proportionate to the outcomes sought, and represents good value for money. Penalise vague, padded, or poorly justified costs.',
  },
  delivery_risk: {
    label: 'Delivery risk',
    weight: 1.5,
    description:
      'The likelihood the work is delivered as described. Score HIGH for low risk (well-scoped, realistic timeline, capacity in place) and LOW for high risk (over-ambitious, dependencies unmanaged, thin plan).',
  },
  additionality: {
    label: 'Additionality',
    weight: 1,
    description:
      "Whether this funding adds something that would not otherwise happen. Penalise work already well-funded elsewhere or duplicating provision; reward filling a genuine gap.",
  },
}

/** Stable criterion order for prompts and UI. */
export const CRITERION_ORDER = Object.keys(CRITERION_DEFINITIONS) as CriterionKey[]

/**
 * Roll the per-criterion 1–10 scores up into a 0–100 composite using the
 * registry weights. Pure and deterministic — the same sub-scores always yield
 * the same composite, so the headline number is auditable from the breakdown.
 */
export function computeComposite(criteria: Record<CriterionKey, { score: number }>): number {
  let weightedSum = 0
  let totalWeight = 0
  for (const key of CRITERION_ORDER) {
    const { weight } = CRITERION_DEFINITIONS[key]
    weightedSum += criteria[key].score * weight
    totalWeight += weight
  }
  // Mean weighted score is on a 1–10 scale; map to 0–100.
  const meanOutOfTen = weightedSum / totalWeight
  return Math.round(meanOutOfTen * 10)
}
