// The app's tab control — the segmented pill from the Applications list (programme
// tabs): a washed track holding 32px buttons, the active one lifted to white with a
// hairline border, each optionally carrying a count.

const C = {
  ink: '#141C24',
  sub: '#637083',
  faint: '#97A1AF',
  line: '#E4E7EC',
  wash: '#F2F4F7',
}

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
}: {
  items: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  ariaLabel?: string
}) {
  // `w-fit` keeps the track hugging its tabs in any parent — as a plain flex/block
  // child it stretched to the full container width (which it did on Finance).
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex w-fit max-w-full items-center gap-0.5 self-start overflow-x-auto rounded-lg p-0.5"
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
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2"
            style={on ? { backgroundColor: '#fff', border: `1px solid ${C.line}` } : undefined}
          >
            <span
              className="whitespace-nowrap font-display text-[14px] font-medium"
              style={{ color: on ? C.ink : C.sub }}
            >
              {t.label}
            </span>
            {t.count !== undefined && (
              <span
                className="font-display text-[14px] font-medium tabular-nums"
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
