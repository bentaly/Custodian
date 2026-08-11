import { useId, useRef } from 'react'
import { PROGRAMME_PALETTE, colourName, normaliseColour } from '../../lib/programmeColours'
import { C } from './tokens'

// The colour a programme is recognised by: ten presets and a custom pick (Figma
// 769:15935). Selection is the dark hairline round the swatch, as the comp draws it.
//
// A radio GROUP, not a row of buttons. Ten independent buttons would each be a tab stop
// and would announce nothing about being one choice among ten; a radiogroup is one stop,
// arrow keys move within it, and a screen reader says "Sky, 1 of 11". The custom swatch
// is a real `<input type="color">` behind a conic-gradient tile, so the OS picker does
// the work.
//
// `taken` DISCOURAGES rather than forbids: used colours dim and say who has them, but
// stay selectable. With ten presets, a foundation with eleven programmes — or archived
// ones still holding colours — must not reach a picker where nothing can be chosen.

export function ColourPicker({
  value,
  onChange,
  taken = {},
  label = 'Colour',
}: {
  value: string
  onChange: (hex: string) => void
  /** hex → what already uses it, e.g. `{'#37d1f7': 'Community & Place'}`. */
  taken?: Record<string, string>
  label?: string
}) {
  const name = useId()
  const custom = useRef<HTMLInputElement>(null)
  const selected = normaliseColour(value)
  const isPreset = PROGRAMME_PALETTE.some((c) => c.hex === selected)

  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-3">
      {PROGRAMME_PALETTE.map((colour) => {
        const owner = taken[colour.hex]
        const checked = selected === colour.hex
        return (
          <label
            key={colour.hex}
            className="relative flex cursor-pointer"
            title={owner ? `${colour.name} — already used by ${owner}` : colour.name}
          >
            <input
              type="radio"
              name={name}
              value={colour.hex}
              checked={checked}
              onChange={() => onChange(colour.hex)}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className={`size-4 rounded-swatch border transition-opacity peer-focus-visible:ring-2 peer-focus-visible:ring-brand/20 ${
                owner && !checked ? 'opacity-30' : ''
              }`}
              style={{
                backgroundColor: colour.hex,
                borderColor: checked ? C.ink : 'transparent',
              }}
            />
            {/* The name and the "in use" reason, for anyone not reading the `title`. */}
            <span className="sr-only">
              {colour.name}
              {owner ? `, already used by ${owner}` : ''}
            </span>
          </label>
        )
      })}

      <label
        className="relative flex cursor-pointer"
        title={isPreset ? 'Choose a custom colour' : `Custom — ${selected}`}
      >
        <input
          ref={custom}
          type="color"
          value={selected ?? '#000000'}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className="size-4 rounded-swatch border peer-focus-visible:ring-2 peer-focus-visible:ring-brand/20"
          style={{
            // The custom tile shows the chosen colour once it is off-palette, so the
            // selection is visible without hunting; otherwise it is the rainbow.
            background: isPreset
              ? 'conic-gradient(#f8518e, #c88a24, #2ab646, #2aa8c6, #9982f7, #eb2ff5, #f8518e)'
              : (selected ?? undefined),
            borderColor: !isPreset && selected ? C.ink : 'transparent',
          }}
        />
        <span className="sr-only">
          Custom colour{!isPreset && selected ? `, currently ${selected}` : ''}
        </span>
      </label>

      <span className="font-display text-label text-gray-500">
        {colourName(selected) ?? 'None'}
      </span>
    </div>
  )
}
