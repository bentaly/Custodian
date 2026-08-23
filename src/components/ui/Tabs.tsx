// The app's tab control — the segmented pill from the Applications list (programme
// tabs): a washed track holding 32px buttons, the active one lifted to white with a
// hairline border, each optionally carrying a count.

import { C } from './tokens'

export type TabItem<T> = {
  id: T
  label: string
  /** Rendered faint after the label. Omit where a count would be noise. */
  count?: number
}

export function Tabs<T>({
  items,
  value,
  onChange,
  ariaLabel,
  fullWidth = false,
}: {
  items: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  ariaLabel?: string
  /**
   * Stretch the track to its container and split it evenly between the tabs.
   *
   * Opt-in, because the default must stay `w-fit` (see below). This is for a tab pair
   * acting as a FIELD in a form — sign-in's Password / Email code — where the control
   * sits in a column of full-width inputs and a hugging track reads as a stray chip
   * rather than as one of the fields.
   */
  fullWidth?: boolean
}) {
  // `w-fit` keeps the track hugging its tabs in any parent — as a plain flex/block
  // child it stretched to the full container width (which it did on Finance). It is
  // what does that job, NOT `self-start`, which used to be here as well and pinned the
  // track to the top of any `items-center` row it sat in — so beside a taller control
  // (Shortlist's export, Finance's) the two were visibly off each other's centre line.
  // `fullWidth` asks for the stretch back, deliberately, for the form case.
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`flex max-w-full items-center gap-0.5 overflow-x-auto rounded-chip p-0.5 ${
        fullWidth ? 'w-full' : 'w-fit'
      }`}
      style={{ backgroundColor: C.wash }}
    >
      {items.map((t) => {
        const on = t.id === value
        return (
          <button
            key={String(t.id ?? 'all')}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={`flex h-8 items-center gap-1.5 rounded-chip px-2 ${
              fullWidth ? 'flex-1 justify-center' : 'shrink-0'
            }`}
            style={on ? { backgroundColor: '#fff', border: `1px solid ${C.line}` } : undefined}
          >
            <span
              className="whitespace-nowrap font-display text-body font-medium"
              style={{ color: on ? C.ink : C.sub }}
            >
              {t.label}
            </span>
            {t.count !== undefined && (
              <span
                className="font-display text-body font-medium tabular-nums"
                style={{ color: C.faint }}
              >
                {t.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
