// ─── No em dashes in what a user reads ───────────────────────────────────────
//
// House style (CLAUDE.md, Conventions): an em dash reads as machine-written. The AI
// prompts ask the model not to use one, but an instruction is not a guarantee, so the
// prose a model returns passes through here before it is stored. A spaced hyphen keeps
// the sentence's meaning whatever kind of clause the dash was introducing, which a
// comma or a full stop would not.
//
// Deep, because structured outputs nest prose in objects and arrays. Callers exclude
// any string that must match something verbatim (a programme's theme, a figure quoted
// from a brief), since a foundation's own text may legitimately carry a dash.

const EM_DASH = /\s*—\s*/g

export function withoutEmDashes<T>(value: T): T {
  if (typeof value === 'string') return value.replace(EM_DASH, ' - ') as T
  if (Array.isArray(value)) return value.map((v) => withoutEmDashes(v)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withoutEmDashes(v)])) as T
  }
  return value
}
