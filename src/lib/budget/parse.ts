// ─── Budget breakdown parsing ────────────────────────────────────────────────
//
// The ingest pipeline is scalar-string end to end: `toStringValue` JSON-stringifies
// any non-primitive payload value before it reaches a canonical slot, so a budget
// breakdown arrives here as a JSON string. This module turns that back into typed
// line items, tolerantly — foundations send a variety of shapes and their amounts
// are routinely formatted ("£22,000").
//
// Beyond item + amount, any further fields on a line are preserved as `details` —
// we don't interpret them, but we don't lose them either (see types.ts).
//
// Returns null when the value isn't a budget breakdown at all (e.g. a free-text
// budget narrative). Callers must preserve the raw value in that case rather than
// dropping it — see `buildCanonicalInput`.

import type { BudgetLine } from './types'

/** Keys a foundation might use for the line's description, most specific first. */
const ITEM_KEYS = ['item', 'label', 'name', 'category', 'description', 'cost', 'line']
/** Keys a foundation might use for the line's figure. */
const AMOUNT_KEYS = ['amount', 'value', 'cost', 'total', 'figure', 'sum', 'price']

/** Parse a possibly-formatted money value ("£22,000", "22000.50") to pounds. */
function toAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null
  if (typeof v !== 'string') return null
  // Strip currency symbols, thousands separators and spaces, as coerceAmount does.
  const n = Number(v.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Stringify a leftover detail value the way the response store does. */
function detailValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

/**
 * Find the entry in `o` whose key (case-insensitively) matches the earliest name
 * in `keys` and whose value satisfies `accept`. Returns the ORIGINAL key so the
 * caller can exclude it from the leftover `details`.
 */
function pick<T>(
  o: Record<string, unknown>,
  keys: string[],
  accept: (v: unknown) => T | null,
): { key: string; value: T } | null {
  const byLower = new Map(Object.keys(o).map((k) => [k.toLowerCase().trim(), k]))
  for (const wanted of keys) {
    const orig = byLower.get(wanted)
    if (orig === undefined) continue
    const value = accept(o[orig])
    if (value != null) return { key: orig, value }
  }
  return null
}

/** One `{item, amount, …}`-ish object → a line. Null if item or amount is missing. */
function lineFromObject(o: Record<string, unknown>): BudgetLine | null {
  // `cost` appears in both key lists — {cost: "Venue", amount: 500} uses it as the
  // label, {item: "Venue", cost: 500} as the figure. Resolve the amount first and
  // keep the item search away from whichever key supplied it.
  const amount = pick(o, AMOUNT_KEYS, toAmount)
  if (!amount) return null
  const item = pick(
    o,
    ITEM_KEYS,
    (v) => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null),
  )
  // A key can't be both the amount and the item; if the item search landed on the
  // amount's key, it found nothing usable.
  if (!item || item.key === amount.key) return null

  const consumed = new Set([amount.key, item.key])
  const details = Object.entries(o)
    .filter(([k]) => !consumed.has(k))
    .map(([k, v]) => ({ label: k, value: detailValue(v) }))
    .filter((d) => d.value)

  const line: BudgetLine = { item: item.value, amount: amount.value }
  if (details.length) line.details = details
  return line
}

/**
 * Coerce an arbitrary payload value into budget line items.
 *
 * Accepts the two shapes foundations actually send:
 *  - an array of objects — `[{item: "Staff", amount: 22000, note: "2 FTE"}, …]`
 *  - a flat map of category → amount — `{"Staff": 22000, "Venue": "£3,000"}`
 *
 * Both may arrive as a JSON string (the usual case, via `toStringValue`) or as a
 * live object (a direct canonical submission). Returns null if the value is
 * neither — including free text, which the caller must keep as a response.
 */
export function parseBudgetBreakdown(raw: unknown): BudgetLine[] | null {
  let v = raw
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s || (s[0] !== '[' && s[0] !== '{')) return null
    try {
      v = JSON.parse(s)
    } catch {
      return null
    }
  }

  if (Array.isArray(v)) {
    const lines = v
      .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
      .map(lineFromObject)
      .filter((l): l is BudgetLine => l !== null)
    return lines.length ? lines : null
  }

  if (typeof v === 'object' && v !== null) {
    // Flat map form: keys are categories, values are amounts. Ignore entries whose
    // value isn't money — that shape means it wasn't a category→amount map.
    const lines: BudgetLine[] = []
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const amount = toAmount(val)
      if (amount != null && k.trim()) lines.push({ item: k.trim(), amount })
    }
    return lines.length ? lines : null
  }

  return null
}

/** Total of all lines, in pounds. NOT comparable to `amountRequested` — see types.ts. */
export function budgetTotal(lines: BudgetLine[]): number {
  return lines.reduce((s, l) => s + l.amount, 0)
}
