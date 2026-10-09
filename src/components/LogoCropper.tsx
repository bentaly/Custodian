/* eslint-disable jsx-a11y/no-noninteractive-tabindex --
   The frame is a focusable custom widget: it handles arrow keys to move the logo, so it
   needs a tab stop. Same reasoning as `AvatarCropper`. */
import { useEffect, useRef, useState } from 'react'
import {
  LOGO_HEIGHT,
  LOGO_MAX_ZOOM,
  LOGO_WIDTH,
  clampAxis,
  containScale,
  type LogoCrop,
  type LogoSource,
} from '../lib/logo'
import { Button } from './ui'
import { C } from './ui/tokens'

// Drag-to-position for a foundation's logo: `AvatarCropper`'s twin in a 3:1 frame, the
// shape the logo is drawn in. Where the avatar must always fill its circle, a logo
// starts with all of it showing and may leave the frame partly empty (`lib/logo.ts`
// says why), so zoom runs UP from "just fits" and dragging keeps it inside the frame.

const FRAME_WIDTH = 360
const FRAME_HEIGHT = Math.round((FRAME_WIDTH * LOGO_HEIGHT) / LOGO_WIDTH)

export function LogoCropper({
  source,
  busy,
  onCancel,
  onConfirm,
}: {
  source: LogoSource
  busy: boolean
  onCancel: () => void
  onConfirm: (crop: LogoCrop) => void
}) {
  const fit = containScale(source.width, source.height, FRAME_WIDTH, FRAME_HEIGHT)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  const displayWidth = source.width * fit * zoom
  const displayHeight = source.height * fit * zoom
  const clamp = (x: number, y: number, dw: number, dh: number) => ({
    x: clampAxis(x, dw, FRAME_WIDTH),
    y: clampAxis(y, dh, FRAME_HEIGHT),
  })

  // A new logo starts flush left and centred top to bottom, where a letterhead puts it.
  useEffect(() => {
    setZoom(1)
    setOffset({ x: 0, y: (FRAME_HEIGHT - source.height * fit) / 2 })
    // Only on a new source; later runs would fight the dragging.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  // Zoom about the frame's centre, so what is in the middle stays in the middle.
  function handleZoom(next: number) {
    const dw = source.width * fit * next
    const dh = source.height * fit * next
    setOffset((o) => {
      const cx = (FRAME_WIDTH / 2 - o.x) / displayWidth
      const cy = (FRAME_HEIGHT / 2 - o.y) / displayHeight
      return clamp(FRAME_WIDTH / 2 - cx * dw, FRAME_HEIGHT / 2 - cy * dh, dw, dh)
    })
    setZoom(next)
  }

  /** The three places a logo usually goes, as one click rather than a careful drag. */
  function align(where: 'left' | 'centre' | 'right') {
    const x =
      where === 'left'
        ? 0
        : where === 'right'
          ? FRAME_WIDTH - displayWidth
          : (FRAME_WIDTH - displayWidth) / 2
    setOffset((o) => clamp(x, o.y, displayWidth, displayHeight))
  }

  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  function handlePointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y }
  }
  function handlePointerMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    setOffset(
      clamp(d.ox + (e.clientX - d.px), d.oy + (e.clientY - d.py), displayWidth, displayHeight),
    )
  }
  function handlePointerUp(e: React.PointerEvent) {
    e.currentTarget.releasePointerCapture(e.pointerId)
    drag.current = null
  }
  function handleKeyDown(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 20 : 5
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = moves[e.key]
    if (!move) return
    e.preventDefault()
    setOffset((o) => clamp(o.x + move[0], o.y + move[1], displayWidth, displayHeight))
  }

  return (
    <div className="rounded-control border p-4" style={{ borderColor: C.line }}>
      {/* White with a dashed edge: the frame's empty part is transparent, and this is
          how it reads on a letter. The edge shows where the frame ends. */}
      <div
        role="application"
        aria-label="Drag to position your logo"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        className="relative mx-auto cursor-grab touch-none overflow-hidden rounded-chip border border-dashed bg-white active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2"
        style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT, borderColor: C.line }}
      >
        <img
          src={source.previewUrl}
          alt=""
          draggable={false}
          className="max-w-none select-none"
          style={{
            width: displayWidth,
            height: displayHeight,
            transform: `translate(${offset.x}px, ${offset.y}px)`,
          }}
        />
      </div>

      <label className="mt-4 flex items-center gap-3">
        <span className="text-label text-grey-500">Zoom</span>
        <input
          type="range"
          min={1}
          max={LOGO_MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(e) => handleZoom(Number(e.target.value))}
          className="flex-1 accent-brand"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-label text-grey-500">Align</span>
        {(['left', 'centre', 'right'] as const).map((where) => (
          <Button
            key={where}
            type="button"
            variant="ghost"
            onClick={() => align(where)}
            disabled={busy}
          >
            {where === 'left' ? 'Left' : where === 'right' ? 'Right' : 'Centre'}
          </Button>
        ))}
      </div>

      <p className="mt-2 text-label text-grey-500">
        Drag the logo to position it, and zoom in to trim any empty space around it.
      </p>

      <div className="mt-4 flex items-center gap-2">
        <Button
          type="button"
          disabled={busy}
          onClick={() =>
            onConfirm({
              frameWidth: FRAME_WIDTH,
              frameHeight: FRAME_HEIGHT,
              displayWidth,
              displayHeight,
              offsetX: offset.x,
              offsetY: offset.y,
            })
          }
        >
          {busy ? 'Saving…' : 'Save logo'}
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
