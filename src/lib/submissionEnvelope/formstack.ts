// ─── Formstack webhook envelope ──────────────────────────────────────────────
//
// Formstack's envelope is nearly the flat object already: one key per question,
// named by the webhook's "field keys" setting (the question label by default), plus
// three keys of Formstack's own on every delivery:
//
//   FormID       — the form's numeric id. The ONLY thing naming the form: unlike
//                  Typeform there is no title anywhere in the delivery.
//   UniqueID     — Formstack's id for this submission.
//   HandshakeKey — the webhook's "Shared Secret", echoed back in the BODY when one is
//                  set. It must never be stored: it would sit in `raw_payload` and be
//                  rendered on View Submission. Our credential is the token in the
//                  path, so the foundation does not need to set one at all; this
//                  reader drops it either way.
//
// So the work here is small and is all about those three keys, plus the one shape a
// JSON delivery has that a hand-written payload would not: a multi-part question
// (name, address) arriving as a nested object, and a multi-select as an array.
//
// Recognised by SHAPE, like every reader: `FormID` and `UniqueID` both present. A
// foundation posting by hand would never send that pair, and the reader works whether
// Formstack posted to its own webhook route or something forwarded the raw delivery to
// `/api/apply`.
//
// The programme: with no form title to map from, a Formstack application form names
// its programme through a question of its own, or (the usual case, one form per
// programme) a HIDDEN field whose default value is the programme's name. That is set
// up on the form, not here.

const RESERVED = new Set(['FormID', 'UniqueID', 'HandshakeKey'])

// The parts of a Name field, in the order a person writes them. Anything else nested
// (an address, a field we have not met) is joined in the order Formstack sent it.
const NAME_PARTS = ['prefix', 'first', 'initial', 'middle', 'last', 'suffix']

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function present(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== ''
}

/** Render one answer as the single value a person would have typed. */
function answerValue(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null
  if (isScalar(raw)) return raw

  // A multi-select. Joined, as Typeform's are, because everything downstream reads a
  // string and a comma list is how a person would have written it.
  if (Array.isArray(raw)) {
    const parts = raw.filter((v) => isScalar(v) && present(v)).map(String)
    if (parts.length === raw.length) return parts.length > 0 ? parts.join(', ') : null
    return JSON.stringify(raw)
  }

  if (isRecord(raw)) {
    const entries = Object.entries(raw)
    // Only an object of plain parts is joined. Anything deeper is a shape we have not
    // met, and is kept verbatim rather than flattened into something that reads right
    // and is not.
    if (!entries.every(([, v]) => v === null || v === undefined || isScalar(v))) {
      return JSON.stringify(raw)
    }
    const keys = entries.map(([k]) => k.toLowerCase())
    const isName = keys.length > 0 && keys.every((k) => NAME_PARTS.includes(k))
    if (isName) {
      const byPart = new Map(entries.map(([k, v]) => [k.toLowerCase(), v]))
      const name = NAME_PARTS.map((p) => byPart.get(p))
        .filter(present)
        .map((v) => String(v).trim())
        .join(' ')
      return name || null
    }
    const joined = entries
      .map(([, v]) => v)
      .filter(present)
      .map((v) => String(v).trim())
      .join(', ')
    return joined || null
  }

  return JSON.stringify(raw)
}

/** True if `body` is a Formstack webhook delivery: `FormID` and `UniqueID` together. */
export function isFormstackEnvelope(body: Record<string, unknown>): boolean {
  return present(body.FormID) && present(body.UniqueID) && isScalar(body.FormID)
}

/**
 * Flatten a Formstack delivery to `{ question → value }`.
 *
 * Synthesises "Submission ID" from `UniqueID` (named to hit the dictionary's
 * "submission id", the reference an application cannot exist without) and "Form ID"
 * for the record. Drops `HandshakeKey`. A question of the form's own with the same
 * name as a synthesised key WINS, since the foundation put it there on purpose.
 *
 * Returns null when nothing but Formstack's own keys arrived. That is the shape of a
 * test delivery, and it must be refused rather than saved as a submission.
 */
export function flattenFormstack(body: Record<string, unknown>): Record<string, unknown> | null {
  if (!isFormstackEnvelope(body)) return null

  const payload: Record<string, unknown> = {
    'Submission ID': String(body.UniqueID).trim(),
    'Form ID': String(body.FormID).trim(),
  }
  let supplied = 0

  for (const [rawKey, raw] of Object.entries(body)) {
    if (RESERVED.has(rawKey)) continue
    const key = rawKey.replace(/\s+/g, ' ').trim()
    if (!key) continue
    const value = answerValue(raw)
    if (!present(value)) continue
    payload[key] = value
    supplied++
  }

  return supplied > 0 ? payload : null
}
