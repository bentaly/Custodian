// ─── Verifying the paragraph against its own brief ───────────────────────────
//
// The summary is printed above a foundation's charts, read by trustees, and
// exported to PDF. A figure in it that the model arrived at by adding two numbers
// together is indistinguishable, on that page, from one we computed — so the rule
// is that it may only quote, never derive, and this is the check that the rule held.
//
// The method is blunt on purpose: pull every numeral out of the prose, pull every
// numeral out of the brief, and fail if the prose contains one the brief does not.
// It is not a semantic check — it cannot tell you the sentence draws a silly
// conclusion — but it catches the failure that actually matters, which is a
// confident, specific, invented number.
//
// Two consequences worth knowing:
//   • The prompt REQUIRES numerals ("14", not "fourteen"), because a spelled number
//     walks straight past this check. That also matches the design, which bolds the
//     figures.
//   • Numerals from the brief's KEYS count as allowed ("deciles 1–4" is licensed by
//     `shareOfMoneyInDeciles1to4`), otherwise the model could not name the band it
//     is quoting.

/** Every numeral appearing anywhere in a value: in numbers, in strings, in keys. */
function collectNumerals(value: unknown, into: Set<string>): void {
  if (value == null) return
  if (typeof value === 'number') {
    into.add(normalise(String(value)))
    return
  }
  if (typeof value === 'string') {
    for (const n of value.match(/\d[\d,.]*/g) ?? []) into.add(normalise(n))
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) collectNumerals(v, into)
    return
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      for (const n of k.match(/\d+/g) ?? []) into.add(normalise(n))
      collectNumerals(v, into)
    }
  }
}

/** `£12,345` → `12345`, `95%` → `95`, `1.0` → `1`. Comparison is on digits alone. */
function normalise(token: string): string {
  const cleaned = token.replace(/[,£%\s]/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? String(n) : cleaned
}

export interface VerificationFailure {
  /** The numerals in the summary that appear nowhere in the brief. */
  unsupportedFigures: string[]
  /** Cited paths that do not resolve in the brief — a weaker signal, reported not enforced. */
  unknownPaths: string[]
}

function resolvePath(brief: unknown, path: string): boolean {
  let node: unknown = brief
  for (const seg of path.split('.')) {
    if (node == null || typeof node !== 'object') return false
    const key = seg.replace(/\[\d+\]$/, '')
    const idx = /\[(\d+)\]$/.exec(seg)?.[1]
    node = (node as Record<string, unknown>)[key]
    if (idx != null) {
      if (!Array.isArray(node)) return false
      node = node[Number(idx)]
    }
  }
  return node !== undefined
}

/**
 * Check a generated summary against the brief it was given.
 *
 * Returns `null` when the paragraph is clean. A non-null result is a refusal: the
 * caller records it as an `error` and leaves whatever was on screen in place, which
 * is always better than replacing a checked paragraph with an unchecked one.
 */
export function verifySummary(
  summary: string,
  figuresCited: string[],
  brief: unknown,
): VerificationFailure | null {
  const allowed = new Set<string>()
  collectNumerals(brief, allowed)

  // Ordinals and small counts the model needs for ordinary English ("the top 3",
  // "one of four programmes") are not claims about the data. Anything above ten is.
  for (let i = 0; i <= 10; i++) allowed.add(String(i))

  const used = (summary.match(/\d[\d,.]*/g) ?? []).map(normalise)
  const unsupportedFigures = [...new Set(used.filter((n) => !allowed.has(n)))]
  const unknownPaths = figuresCited.filter((p) => !resolvePath(brief, p))

  if (unsupportedFigures.length === 0) return null
  return { unsupportedFigures, unknownPaths }
}
