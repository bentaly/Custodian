import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { C } from './tokens'
import { useRef, useState } from 'react'
import { MultiListbox, type ListboxOption } from './Listbox'
import { Tooltip } from './Tooltip'
import { toggleFilterValue } from '../../lib/filterSelection'

// The filter pill every list/analysis screen shares (Figma 393:29540): a 32px
// bordered chip showing either the label ("Programme") or what is chosen, which
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
// ── Several values ───────────────────────────────────────────────────────────────────
// Every pill is multi-select: the panel draws tick boxes and stays open while you tick.
// What a selection MEANS — OR within a pill, AND across pills, and every option ticked
// being stored as no filter — is `lib/filterSelection`, shared with the SQL and with the
// screens that filter in the browser. "All programmes" stays as the panel's first row and
// is ticked whenever nothing else is, which is how "all" and "none" read as one state.
//
// The chip names the first value picked and counts the rest ("Youth work +2"), in the
// order they were ticked, so ticking a second value extends the label rather than
// rewriting it. Hovering or focusing a pill holding two or more lists them, up to
// `LISTED`, because "+2" alone is a promise you have to open the panel to cash.
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
//  2. **Options are faceted with counts** (`src/lib/facets.ts`), so a pill only ever
//     offers values the rows in view actually hold — "Youth work (24)". The count is
//     passed as `count` and drawn in the PANEL only; the chip names the value alone,
//     because "East of England (2)" in the row read as two things selected. Fixed
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

// ── Searchable ───────────────────────────────────────────────────────────────────────
// `searchable` is for the pill whose options are not a short vocabulary but whatever the
// data holds — the Awards register's Location, a district per grant. It adds three
// things and changes nothing else about the pill:
//
//  - A search box at the top of the panel (see `ui/Listbox`), matching anywhere in the
//    name, ignoring case and accents, so "ynys mon" finds Ynys Môn. Filtered here in
//    the browser: the facet already carries every option, and a few hundred places is
//    nothing to hold, where a server round trip per keystroke would cost a subrequest
//    and turn a selected-but-unloaded value into a label we cannot draw.
//  - Ticked values PINNED at the top, under the clear row, whatever the query — a
//    selection you cannot see is one you cannot undo. The pinned set is taken as the
//    panel opens and held while it is open, so ticking a row does not snatch it out
//    from under the pointer to the top of the list.
//  - A second grey line per option (`description`), saying what kind of thing it is.
//
// The box and the pinning appear only past `SEARCH_FROM` options. Below that the whole
// list is in view and a search box is one more thing to read above it; the grey kind
// line stays either way. This is the one sanctioned exception to rule 4: the CHIP in the
// row never changes, only what opens beneath it.

/** A `searchable` pill offers its search box once it has MORE options than this. */
export const SEARCH_FROM = 10

/** How many chosen values the hover list names before counting the rest. */
const LISTED = 10

export function FilterPill({
  label,
  plural,
  value,
  options,
  onChange,
  searchable = false,
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
  /** The values ticked, in the order they were ticked. `undefined` is the filter off. */
  value: readonly string[] | undefined
  options: Array<{
    value: string
    label: string
    /** A second grey line in the panel. The chip and the hover list use `label` alone. */
    description?: string
    /**
     * How many rows hold it — the facet count. Shown in the PANEL only ("Youth work (24)"),
     * never on the chip: "East of England (2)" in the row read as two things selected.
     */
    count?: number
  }>
  /** Never called with an empty list: no selection is `undefined`. */
  onChange: (v: string[] | undefined) => void
  /** A search box in the panel, and ticked values pinned to the top — see above. */
  searchable?: boolean
}) {
  const empty = options.length === 0
  // Greyed to the same faint the app uses for "nothing here" everywhere else, so an
  // inert pill is legible as inert without a second visual language for disabled.
  const ink = empty ? C.faint : C.ink

  // A value no longer among the faceted options is not drawn, as it was not when this was
  // a <select> that could not show it either — and the next tick drops it, because a
  // selection the pill cannot show is not one it should carry forward.
  const chosen = (value ?? []).flatMap((v) => options.filter((o) => o.value === v))
  const optionValues = options.map((o) => o.value)

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  // Read during render: while the panel is shut this tracks the selection, so on the
  // render that opens it, it already holds the selection as it stood — and then stops
  // moving until the panel shuts again.
  const pinned = useRef<readonly string[]>([])
  if (!open) pinned.current = chosen.map((o) => o.value)

  let listed: ListboxOption[] = options
  const withSearch = searchable && options.length > SEARCH_FROM
  if (withSearch) {
    const needle = searchKey(query)
    const matches = (o: (typeof options)[number]) => searchKey(o.label).includes(needle)
    const ticked = chosen.map((o) => o.value)
    const wasPinned = (o: { value: string }) => pinned.current.includes(o.value)
    // Pinning protects a TICKED value from the query. One unticked since the panel
    // opened keeps its place at the top (no jump under the pointer) only while it still
    // matches; otherwise the query hides it like any other row.
    const pinnedRows = options.filter(
      (o) => wasPinned(o) && (ticked.includes(o.value) || matches(o)),
    )
    const hits = options.filter((o) => !wasPinned(o) && matches(o))
    listed = [
      ...pinnedRows,
      ...hits,
      // Said only when NOTHING matches: a pinned row that matches is an answer.
      ...(needle && !options.some(matches)
        ? [{ value: '\u0000no-match', label: `No ${plural} match "${query.trim()}"`, note: true }]
        : []),
    ]
  }
  const all: ListboxOption[] = [
    { value: '', label: `All ${plural}` },
    ...listed.map((o) =>
      'count' in o && typeof o.count === 'number' ? { ...o, label: `${o.label} (${o.count})` } : o,
    ),
  ]

  return (
    <MultiListbox
      className="shrink-0"
      options={all}
      // The clear row is ticked exactly when nothing else is.
      values={chosen.length > 0 ? chosen.map((o) => o.value) : ['']}
      onToggle={(v) =>
        onChange(
          v === ''
            ? undefined
            : toggleFilterValue(
                chosen.map((o) => o.value),
                v,
                optionValues,
              ),
        )
      }
      ariaLabel={label}
      search={
        withSearch
          ? { value: query, onChange: setQuery, placeholder: `Search ${plural}` }
          : undefined
      }
      onOpenChange={(next) => {
        setOpen(next)
        // A query is for this visit to the panel; the next one starts on the whole list.
        if (!next) setQuery('')
      }}
      // Disabled rather than absent when there is nothing to pick: the chip keeps its
      // place in the row, but tab order skips a menu of one line.
      disabled={empty}
      renderTrigger={({ open, props }) => (
        <Tooltip
          control
          label={label}
          // Not over its own panel, and not when the chip already says everything.
          disabled={open || chosen.length < 2}
          trigger={
            <button
              {...props}
              className="flex h-8 cursor-pointer items-center gap-1 rounded-chip border py-2 pl-2 pr-1.5 focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden disabled:cursor-default"
              style={{
                borderColor: chosen.length > 0 || open ? C.brand : C.line,
                backgroundColor: chosen.length > 0 ? C.brandBg : C.white,
              }}
            >
              <span
                className="whitespace-nowrap font-display text-body font-medium"
                style={{ color: ink }}
              >
                {empty
                  ? `No ${plural}`
                  : chosen.length === 0
                    ? label
                    : chosen.length === 1
                      ? chosen[0]!.label
                      : `${chosen[0]!.label} +${chosen.length - 1}`}
              </span>
              <HugeiconsIcon icon={ArrowDown01Icon} size={16} color={ink} />
            </button>
          }
        >
          <span className="flex flex-col">
            {chosen.slice(0, LISTED).map((o) => (
              <span key={o.value}>{o.label}</span>
            ))}
            {chosen.length > LISTED && (
              <span className="text-grey-500">+ {chosen.length - LISTED} more</span>
            )}
          </span>
        </Tooltip>
      )}
    />
  )
}

/** Case- and accent-blind, so "ynys mon" finds Ynys Môn and "BLACKPOOL" finds Blackpool. */
function searchKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}
