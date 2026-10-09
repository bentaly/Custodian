import { useEffect, useState, useSyncExternalStore } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  Cancel01Icon,
  InformationCircleIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { C } from './tokens'

/**
 * A short message in the top right: "Giving strategy saved".
 *
 * Built for the case where the screen otherwise gives no sign anything happened, which is
 * what a foundation reported on the giving strategy: a Save button whose label flickered
 * for two seconds read as a button that did nothing.
 *
 * Three tones, chosen against the "Custodian Toast Styles" artifact (2026-10-07):
 *
 *   • `toast(…)` / `toast.success(…)` — Mint (Brand Secondary). Something worked.
 *   • `toast.info(…)` — Paper (white). Neutral news that is neither good nor bad.
 *   • `toast.error(…)` — Danger. Something failed and there is no control to put the
 *     message beside: a background send, an action from a menu that has since closed.
 *     A failure on a FORM still belongs in an `ErrorNote` beside the control, because
 *     the user has to act on it there. An error toast also stays until it is dismissed,
 *     since a failure that vanishes after three seconds may never have been read.
 *
 * Call it from anywhere; `<Toaster />` is mounted once, in the authenticated shell. A
 * module-level store rather than a context, so a server-fn handler deep in a dialog does
 * not need a provider threaded down to it.
 */

export type ToastTone = 'success' | 'info' | 'error'

type ToastItem = { id: number; message: string; tone: ToastTone }

const DURATION_MS = 3500

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id)
  emit()
}

function show(message: string, tone: ToastTone) {
  const id = nextId++
  // The newest on top, and at most three: a burst of saves should not build a tower.
  items = [{ id, message, tone }, ...items].slice(0, 3)
  emit()
  if (tone !== 'error') setTimeout(() => dismiss(id), DURATION_MS)
}

export const toast = Object.assign((message: string) => show(message, 'success'), {
  success: (message: string) => show(message, 'success'),
  info: (message: string) => show(message, 'info'),
  error: (message: string) => show(message, 'error'),
})

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = () => items
// One array, not a fresh `[]` per call: React compares snapshots by identity and loops
// on a server snapshot that changes every time it is read.
const NO_TOASTS: ToastItem[] = []
const getServerSnapshot = () => NO_TOASTS

export function Toaster() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed top-4 right-4 z-[60] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2 print:hidden"
    >
      {current.map((t) => (
        <ToastCard key={t.id} item={t} />
      ))}
    </div>
  )
}

/** The card's colours. The backgrounds are OPAQUE (mixed with white, not alpha), since a
 *  toast sits over whatever the page has under it. */
const TONE: Record<
  ToastTone,
  { icon: typeof Tick02Icon; iconColour: string; bg: string; border: string; close: string }
> = {
  success: {
    icon: Tick02Icon,
    iconColour: C.brand,
    bg: 'var(--color-brand-secondary)',
    border: 'color-mix(in srgb, var(--color-brand) 22%, transparent)',
    close: 'color-mix(in srgb, var(--color-brand) 60%, var(--color-grey-500))',
  },
  info: {
    icon: InformationCircleIcon,
    iconColour: C.sub,
    bg: C.white,
    border: C.line,
    close: C.faint,
  },
  error: {
    icon: Alert02Icon,
    iconColour: 'var(--color-danger)',
    bg: 'color-mix(in srgb, var(--color-danger) 8%, white)',
    border: 'color-mix(in srgb, var(--color-danger) 25%, transparent)',
    close: 'var(--color-danger)',
  },
}

function ToastCard({ item }: { item: ToastItem }) {
  // Mounted at rest, then moved in, so the card slides rather than appearing.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  const tone = TONE[item.tone]

  return (
    <div
      // An error interrupts; anything else waits its turn.
      role={item.tone === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto flex items-start gap-2 rounded-card border px-3 py-2.5 font-display text-body shadow-lg transition duration-200 ${
        shown ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
      }`}
      style={{ backgroundColor: tone.bg, borderColor: tone.border, color: C.ink }}
    >
      <HugeiconsIcon
        icon={tone.icon}
        size={16}
        strokeWidth={2}
        color={tone.iconColour}
        className="mt-0.5 shrink-0"
      />
      <span className="flex-1">{item.message}</span>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label="Dismiss"
        className="mt-0.5 shrink-0 rounded-chip hover:opacity-70"
        style={{ color: tone.close }}
      >
        <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
      </button>
    </div>
  )
}
