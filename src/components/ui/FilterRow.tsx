import type { ReactNode } from 'react'

// The row every list screen narrows itself with: the filter pills, and — hard right —
// the box that searches the table under them.
//
// It exists to make one rule structural rather than remembered. Search started life up
// in each screen's HEADER, beside the <h1> and the round pill, which put "find a row in
// this table" a card-width away from the table and on the far side of the budget and
// portfolio panels: on Applications it sat above a summary card, a programme selector
// and an export button, none of which it had anything to do with. Filters and search
// are the same job — cut this list down — so they belong on the same line, and a
// component that takes both is the only version of that rule a new screen cannot get
// wrong.
//
// Search goes LAST, on the right. The pills read left to right in the shared order
// (see `ui/FilterPill`), which is a fixed vocabulary you scan; the search box is
// open-ended and typed into, and putting it at the end of the row keeps the pills
// starting at the same x on every screen whether or not that screen can be searched.
//
// Below `sm` it drops to its own full-width line instead of being squeezed: a search
// field narrow enough to sit beside three pills on a phone is too narrow to read what
// you typed.
export function FilterRow({ children, search }: { children: ReactNode; search?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {children}
      {search && <div className="w-full sm:ml-auto sm:w-auto">{search}</div>}
    </div>
  )
}
