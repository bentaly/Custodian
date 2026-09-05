import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { C } from './tokens'
import { Listbox } from './Listbox'

// The filter pill every list/analysis screen shares (Figma 393:29540): a 32px
// bordered chip showing either the label ("Programme") or the chosen value, which
// opens the app's own `Listbox` panel.
//
// It used to lay a transparent native <select> over the chip, which bought keyboard
// and mobile pickers for free but left the OPEN panel looking like whatever the
// browser felt like — blue system highlight, system font, no relation to the Gray/100
// panel `SelectPill` and `Select` drop below them. Two dropdowns side by side on the
// same row opening two different-looking menus is the drift these components exist to
// prevent, so this made the same move `SelectPill` had already made: `Listbox` earns
// back arrow keys, Home/End, Enter/Space, Escape and typeahead by hand.
//
// Text, icon and caret are Gray/900 in both states: the words are what you read, and
// they should not change colour under you when you pick something. What changes is the
// *surface* — a pill holding a value goes brand-tinted, because with several pills in a
// row "which filters are on" has to be readable at a glance rather than pill by pill.
//
// ── The filter row, wherever a list screen wears one ─────────────────────────────────
// Every row follows the same rules, so that "how do I narrow this" is learned once
// rather than per screen:
//
//  1. **Order**: Status · Round · Programme · Theme · the screen's own (AI score, Valid),
//     then the date range last. A screen simply omits what it hasn't got; it never
//     reorders what it has.
//
//     **Round comes before Programme, here and in the table's columns**, because that is
//     the containment: a round holds programmes, a programme holds the row. Reading
//     outward-in is the same order the data is shaped in, and it makes the two controls
//     that narrow by "which pot" adjacent and always the same way round — the screens
//     had them in three different orders, so the pill you wanted was in a different
//     place on each. Where a screen is READ inside one round (Applications, Shortlist)
//     the round is the context above the row, not a pill in it, and Programme leads.
//  2. **Options are faceted with counts** (`src/lib/facets.ts` → `facetLabel`), so a pill
//     only ever offers values the rows in view actually hold — "Youth work (24)". Fixed
//     vocabularies (status enums, score bands) are the exception: those name every value
//     whether or not it is present, because their absence is itself the answer.
//  3. **Search sits at the END of the row, hard right** — `ui/FilterRow` is what lays
//     that out, and every list screen goes through it. Filters and search do the same
//     job, so they share a line; the pills keep starting at the same x on every screen
//     whether or not that screen can be searched.
//  4. **The row is the same row whatever the data.** A pill is rendered even with one
//     option, and with none it stays in place reading "No programmes", greyed and inert.
//     The thin-data version of a screen should differ from the full one by what the
//     controls SAY, not by which controls exist: a filter that vanishes reads as a
//     feature the app hasn't got, and a row that changes width as data arrives makes
//     every screen look slightly different from every other.
//
// Rule 4 costs something and it is worth naming: with a single option, choosing it and
// clearing it return the same rows, so that pill genuinely does nothing. We show it
// anyway, because "this filter is pointless right now" is a smaller confusion than
// "this screen doesn't have that filter".

export function FilterPill({
  label,
  plural,
  value,
  options,
  onChange,
}: {
  /** Shown when nothing is selected — the singular noun. "Programme". */
  label: string
  /**
   * The label's plural, which the two stock lines are built from: "All programmes" (the
   * panel's clear row) and "No programmes" (the empty state). One prop rather than
   * two so they cannot disagree — and not derived from `label`, because the obvious
   * `${label.toLowerCase()}s` gives "All statuss" and "All AI scores" is not "All scores".
   */
  plural: string
  value: string | undefined
  options: Array<{ value: string; label: string }>
  onChange: (v: string | undefined) => void
}) {
  const empty = options.length === 0
  // Greyed to the same faint the app uses for "nothing here" everywhere else, so an
  // inert pill is legible as inert without a second visual language for disabled.
  const ink = empty ? C.faint : C.ink
  const all = [{ value: '', label: `All ${plural}` }, ...options]

  return (
    <Listbox
      className="shrink-0"
      options={all}
      value={value ?? ''}
      // The clear row carries `''`; the filter's "off" is `undefined`.
      onChange={(v) => onChange(v || undefined)}
      ariaLabel={label}
      // Disabled rather than absent when there is nothing to pick: the chip keeps its
      // place in the row, but tab order skips a menu of one line.
      disabled={empty}
      renderTrigger={({ open, selected, props }) => {
        // A value that is no longer in the faceted options reads as unselected, as it
        // did when this was a <select> that could not show it either.
        const chosen = selected?.value ? selected : undefined
        return (
          <button
            {...props}
            className="flex h-8 cursor-pointer items-center gap-1 rounded-chip border py-2 pl-2 pr-1.5 focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden disabled:cursor-default"
            style={{
              borderColor: chosen || open ? C.brand : C.line,
              backgroundColor: chosen ? C.brandBg : C.white,
            }}
          >
            <span
              className="whitespace-nowrap font-display text-body font-medium"
              style={{ color: ink }}
            >
              {empty ? `No ${plural}` : (chosen?.label ?? label)}
            </span>
            <HugeiconsIcon icon={ArrowDown01Icon} size={16} color={ink} />
          </button>
        )
      }}
    />
  )
}
