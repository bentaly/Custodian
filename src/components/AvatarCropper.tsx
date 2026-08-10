import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_ZOOM, type AvatarCrop, type AvatarSource } from '../lib/avatar'
import { Button } from './ui'

// Drag-to-reposition avatar crop. The viewport is a fixed square the image pans behind;
// the image is never allowed to pan far enough to expose an edge, so the crop is always
// fully covered and we never have to deal with letterboxing.

const VIEWPORT = 240

export function AvatarCropper({
  source,
  busy,
  onCancel,
  onConfirm,
}: {
  source: AvatarSource
  busy: boolean
  onCancel: () => void
  onConfirm: (crop: AvatarCrop) => void
}) {
  // Scale at which the shorter edge exactly fills the viewport — the minimum zoom, since
  // anything less would leave a gap.
  const coverScale = VIEWPORT / Math.min(source.width, source.height)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  const displayWidth = source.width * coverScale * zoom
  const displayHeight = source.height * coverScale * zoom

  // Keep the image covering the viewport: its top-left may not go positive, and its
  // bottom-right may not come inside. Applied on every move and after every zoom change.
  const clamp = useCallback(
    (x: number, y: number, dw: number, dh: number) => ({
      x: Math.min(0, Math.max(VIEWPORT - dw, x)),
      y: Math.min(0, Math.max(VIEWPORT - dh, y)),
    }),
    [],
  )

  // Centre the image when it first loads.
  useEffect(() => {
    setOffset(
      clamp(
        (VIEWPORT - displayWidth) / 2,
        (VIEWPORT - displayHeight) / 2,
        displayWidth,
        displayHeight,
      ),
    )
    // Only on a new source — later runs would fight the user's dragging.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  // Zoom about the centre of the viewport, so the subject under the middle stays put
  // rather than the image appearing to slide away from the corner.
  function handleZoom(next: number) {
    const dw = source.width * coverScale * next
    const dh = source.height * coverScale * next
    setOffset((o) => {
      const cx = (VIEWPORT / 2 - o.x) / displayWidth
      const cy = (VIEWPORT / 2 - o.y) / displayHeight
      return clamp(VIEWPORT / 2 - cx * dw, VIEWPORT / 2 - cy * dh, dw, dh)
    })
    setZoom(next)
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

  // Arrow keys nudge, so repositioning does not require a pointer.
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
    <div className="rounded-control border border-gray-200 p-4">
      <div
        role="application"
        aria-label="Drag to reposition your photo"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        className="relative mx-auto cursor-grab touch-none overflow-hidden rounded-full bg-gray-100 active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2"
        style={{ width: VIEWPORT, height: VIEWPORT }}
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
        <span className="text-label text-gray-500">Zoom</span>
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(e) => handleZoom(Number(e.target.value))}
          className="flex-1 accent-brand"
        />
      </label>

      <p className="mt-2 text-label text-gray-500">Drag the photo to reposition it.</p>

      <div className="mt-4 flex items-center gap-2">
        <Button
          type="button"
          disabled={busy}
          onClick={() =>
            onConfirm({
              viewport: VIEWPORT,
              displayWidth,
              displayHeight,
              offsetX: offset.x,
              offsetY: offset.y,
            })
          }
        >
          {busy ? 'Saving…' : 'Save photo'}
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
