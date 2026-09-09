import { useRef } from 'react'
import { colourName, normaliseColour } from '../../lib/programmeColours'
import { Button } from './Button'
import { C } from './tokens'

// The colour a programme is recognised by: the swatch it currently has, and a button
// that opens the OS colour picker.
//
// It USED to offer the ten-colour palette (Figma 769:15935) as a row of swatches, and
// that row was answering a question nobody asks. A programme's colour is assigned on
// create by `nextProgrammeColour`, which picks the hue furthest from the ones already
// in use — so the colour a foundation is handed is already the non-clashing one, and
// presenting ten alternatives turned a settled field into a decision, in the middle of
// a form about themes and impact units. What is left is the exception path: somebody who
// wants a particular colour, who gets the whole wheel rather than ten of it.
//
// So there is no palette here and no preset names on screen. The presets still exist and
// still do the work they were built for — the ramp behind `nextProgrammeColour` and
// `colourSeries` — they are simply not a thing to choose from any more.
//
// `Reset to default` is the way back: a custom pick is a decision, and undoing one by
// hand means finding a hex nobody wrote down. It resets to what the colour would have
// been ASSIGNED — the free hue `nextProgrammeColour` picks — not to what was last saved,
// so it means the same thing on a programme created before the picker existed as on one
// somebody recoloured five minutes ago. It is ABSENT rather than disabled while the colour
// already is the default: a permanently greyed-out button is a control the form is offering
// and refusing in the same breath, and on the common path — every programme that never had
// its colour touched — that is the only state it would ever be seen in.
//
// The input is a real `<input type="color">`, kept off-screen with the button driving it,
// so the OS picker does the work and the trigger can be the app's own button rather than
// the browser's swatch control (which cannot be sized or styled, and looks like a form
// field from another site).

export function ColourPicker({
  value,
  onChange,
  taken = {},
  defaultValue,
  label = 'Colour',
}: {
  value: string
  onChange: (hex: string) => void
  /** hex → what already uses it, e.g. `{'#37d1f7': 'Community & Place'}`. The picker
   *  cannot stop a clash now that any colour can be chosen, so it says so instead —
   *  and stays silent unless there is one. */
  taken?: Record<string, string>
  /** The colour this thing would have been ASSIGNED — `nextProgrammeColour` over the
   *  colours in use, not the one it was last saved with. Given one, a Reset offers the
   *  way back out of a custom pick, and appears only while the colour is something else.
   *  Omitted, there is no Reset at all — a picker with no assignment behind it has no
   *  default to go back to. */
  defaultValue?: string
  label?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const selected = normaliseColour(value)
  const owner = selected ? taken[selected] : undefined
  const fallback = normaliseColour(defaultValue)

  return (
    <div className="flex flex-col gap-1.5">
      {/* `relative` for the `sr-only` colour input below — see the note on `Checkbox`:
          an unscoped one is positioned against the page and pushes the document's
          scroll height past the shell. */}
      <div className="relative flex items-center gap-2">
        {/* `aria-hidden`: the swatch is what the button below acts on, and the button
            says so in words. */}
        <span
          aria-hidden="true"
          className="size-4 shrink-0 rounded-swatch border"
          style={{ backgroundColor: selected ?? undefined, borderColor: C.line }}
        />
        <input
          ref={input}
          type="color"
          value={selected ?? '#000000'}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />
        <Button
          type="button"
          variant="secondary"
          size="xs"
          aria-label={`Change ${label.toLowerCase()}${
            colourName(selected) ? ` — currently ${colourName(selected)}` : ''
          }`}
          onClick={() => {
            // `showPicker` opens it without a synthetic click on a hidden control, which
            // some browsers ignore; `click` is the fallback for those that lack it.
            const el = input.current
            if (!el) return
            if (typeof el.showPicker === 'function') el.showPicker()
            else el.click()
          }}
        >
          Change
        </Button>
        {fallback && selected !== fallback && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={`Reset ${label.toLowerCase()} to default`}
            onClick={() => onChange(fallback)}
          >
            Reset to default
          </Button>
        )}
      </div>
      {owner && <p className="font-display text-label text-grey-500">Already used by {owner}.</p>}
    </div>
  )
}
