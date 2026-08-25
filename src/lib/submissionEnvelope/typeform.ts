// ─── Typeform webhook envelope ───────────────────────────────────────────────
//
// Typeform posts a nested envelope, not a flat object: the QUESTIONS live in
// `form_response.definition.fields[]` and the ANSWERS in `form_response.answers[]`,
// joined on field id, with the value under a key named after the answer's own type
// (`text`, `number`, `choice`, `file_url`, …). Nothing downstream should know that.
//
// This module renders the envelope as the flat `{ question → value }` object a
// foundation "would have sent" by hand, and hands it to the canonical mapper
// unchanged. That is the whole trick: one reader per platform, and the mapper,
// the tier registry and the review queue stay exactly as they are.
//
// It replaces a Make scenario whose HTTP module did this join by hand, one field at
// a time. The cost of that is not the mapping — Make forwarded most questions under
// their real wording, so the mapper still did its job — but that the scenario has to
// be kept in step with the form BY HAND: a question added in Typeform reaches nobody
// until someone remembers to add it in Make, and it goes missing with no blocker, no
// queue entry and no "Not captured" panel, because it never arrives at all. A webhook
// carries every answer by construction.

/** A Typeform answer carries its value under a key named after its own type. */
function answerValue(answer: Record<string, unknown>): unknown {
  const type = typeof answer.type === 'string' ? answer.type : null
  if (!type) return null
  const raw = answer[type]

  switch (type) {
    // A single choice is either one of the offered labels or the free-text "other".
    case 'choice': {
      const choice = raw as { label?: unknown; other?: unknown } | null
      if (!choice || typeof choice !== 'object') return null
      return choice.label ?? choice.other ?? null
    }
    // Multi-select. Joined rather than left as an array because everything
    // downstream — the canonical validators, `responses`, the application screen —
    // reads a string, and a comma list is how a person would have typed it.
    case 'choices': {
      const choices = raw as { labels?: unknown; other?: unknown } | null
      if (!choices || typeof choices !== 'object') return null
      const labels = Array.isArray(choices.labels) ? choices.labels.map(String) : []
      if (typeof choices.other === 'string' && choices.other) labels.push(choices.other)
      return labels.length > 0 ? labels.join(', ') : null
    }
    case 'payment': {
      const payment = raw as { amount?: unknown } | null
      return payment && typeof payment === 'object' ? (payment.amount ?? null) : null
    }
    // `file_url` is deliberately NOT special-cased into some richer shape. The URL's
    // own form says whether it can be opened (Typeform serves uploads from two
    // different paths, only one of which is reachable without a bearer token), so
    // that question is answered by re-reading the stored payload — the same reason
    // `fieldMapping/diagnose.ts` re-derives blockers instead of storing them.
    default:
      break
  }

  // Everything else — text, email, number, boolean, date, url, phone_number, and
  // any answer type Typeform adds later — is either a scalar under its own name or
  // a shape we have not met. Scalars pass through; anything else is JSON so that an
  // unrecognised answer is preserved verbatim rather than silently dropped.
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'object') return JSON.stringify(raw)
  return raw
}

/** Collapse a question title to the single line a lookup table can be keyed on. */
function normaliseTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * True if `body` is a Typeform webhook envelope. Keyed on `form_response` holding
 * an `answers` array — the shape no hand-written flat payload would ever have.
 */
export function isTypeformEnvelope(body: Record<string, unknown>): boolean {
  const response = body.form_response
  return isRecord(response) && Array.isArray(response.answers)
}

/**
 * Flatten a Typeform envelope to `{ question title → value }`.
 *
 * Beyond the answers themselves it synthesises three keys the foundation's form
 * cannot supply but the pipeline needs:
 *
 *   "Submission ID" — `form_response.token`, Typeform's own id for the response.
 *     `externalApplicationId` is a REQUIRED canonical field, and a form almost never
 *     asks the applicant for a reference, so without this every submission would
 *     hold at `needs_review`. Named to hit the built-in dictionary's "submission id".
 *   "Form name"     — the form's title, the only thing in the envelope that names
 *     what was applied to. `programmeName` is required and deliberately absent from
 *     the common dictionary, so this is what a per-client `field_mappings` row points
 *     at (or a hidden field below overrides).
 *   "Submitted at"  — for the record; nothing maps it, so it lands in `responses`.
 *
 * Hidden fields are merged in last and WIN over a synthesised key of the same name:
 * a hidden field is something the foundation deliberately put on the URL, so it is a
 * more specific statement of intent than anything we inferred.
 */
export function flattenTypeform(body: Record<string, unknown>): Record<string, unknown> | null {
  const response = body.form_response
  if (!isRecord(response) || !Array.isArray(response.answers)) return null

  const definition = isRecord(response.definition) ? response.definition : {}
  const fields = Array.isArray(definition.fields) ? definition.fields : []

  // Question id → title, so an answer can be given the name the applicant saw.
  const titleById = new Map<string, string>()
  for (const field of fields) {
    if (!isRecord(field)) continue
    const id = typeof field.id === 'string' ? field.id : null
    const title = typeof field.title === 'string' ? normaliseTitle(field.title) : ''
    if (id && title) titleById.set(id, title)
  }

  const payload: Record<string, unknown> = {}
  // Counts only what the applicant actually supplied. The three synthesised keys
  // below describe a submission rather than being one, so an envelope carrying
  // nothing else — Typeform's "test" delivery, which posts a response with no
  // answers — must NOT flatten to a truthy payload. Otherwise it saves an ingest
  // row holding a response id and a form name, and the sender gets a success for
  // a submission that does not exist: the silent success `parseSubmissionPayload`
  // exists to refuse.
  let supplied = 0

  if (typeof response.token === 'string' && response.token) {
    payload['Submission ID'] = response.token
  }
  if (typeof definition.title === 'string' && normaliseTitle(definition.title)) {
    payload['Form name'] = normaliseTitle(definition.title)
  }
  if (typeof response.submitted_at === 'string' && response.submitted_at) {
    payload['Submitted at'] = response.submitted_at
  }

  for (const answer of response.answers) {
    if (!isRecord(answer)) continue
    const field = isRecord(answer.field) ? answer.field : {}
    const id = typeof field.id === 'string' ? field.id : null
    // `ref` is the foundation's own name for the question where they set one, and the
    // only handle left when a question carries no title (a legal-consent tickbox, say).
    const ref = typeof field.ref === 'string' ? field.ref : null
    const key = (id && titleById.get(id)) || ref || id
    if (!key) continue

    const value = answerValue(answer)
    if (value === null || value === undefined || value === '') continue

    // Two questions can carry the same title — Typeform allows it, and a form with a
    // repeated "Amount" in two sections is ordinary. Last-write-wins would lose one
    // answer with nothing anywhere saying so, so the collision is made visible in the
    // key instead: the reviewer sees "Amount" and "Amount (2)" in the mapping grid.
    let unique = key
    let n = 2
    while (unique in payload) unique = `${key} (${n++})`
    payload[unique] = value
    supplied++
  }

  if (isRecord(response.hidden)) {
    for (const [key, value] of Object.entries(response.hidden)) {
      if (value === null || value === undefined || value === '') continue
      payload[normaliseTitle(key)] = value
      supplied++
    }
  }

  return supplied > 0 ? payload : null
}
