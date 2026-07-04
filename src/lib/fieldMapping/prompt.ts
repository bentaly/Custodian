// ─── Field mapping: prompt builders ──────────────────────────────────────────
//
// Pure string builders, split for prompt caching like the Custodian-score prompts:
//   • buildSystemPrompt() — the task + rules, identical every call → cached.
//   • buildUserPrompt()   — the specific unresolved fields + payload → volatile.

export interface FieldMappingPromptInput {
  /** The unresolved required canonical fields (application or report vocabulary). */
  fields: Array<{ key: string; label: string; description: string }>
  /** The still-unmapped payload entries (key + value). */
  payload: Array<{ key: string; value: string }>
}

export function buildSystemPrompt(formKind: 'grant application' | 'grant report' = 'grant application'): string {
  return `You map fields from a ${formKind} form onto a fixed set of canonical fields.

You will be given:
- a list of CANONICAL FIELDS that still need a value (each with a key and a description), and
- a list of AVAILABLE PAYLOAD FIELDS from the applicant's submission (each a key and its value).

For each canonical field, pick the single payload key whose value best fills it, and give a confidence from 0 to 1. Match on the meaning of the field AND the shape of the value — e.g. a UK sort code looks like nn-nn-nn, a bank account number is around 8 digits, an amount is a monetary value. If no payload field is a credible match, return null for sourceKey with a low confidence. Do NOT guess.

Be conservative: only give a confidence above 0.85 when you are genuinely sure, because high-confidence matches are applied automatically without human review. Return exactly one proposal per canonical field you were asked about, using the canonical key verbatim.`
}

export function buildUserPrompt(input: FieldMappingPromptInput): string {
  const fields = input.fields.map((f) => `- \`${f.key}\`: ${f.description}`).join('\n')
  const payload = input.payload.length
    ? input.payload.map((p) => `- \`${p.key}\`: ${truncate(p.value)}`).join('\n')
    : '(no unmapped payload fields)'
  return `# Canonical fields needing a value\n${fields}\n\n# Available payload fields\n${payload}`
}

function truncate(v: string, max = 200): string {
  return v.length > max ? `${v.slice(0, max)}…` : v
}
