import { useEffect, useState, useSyncExternalStore } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { C } from './tokens'

/**
 * Confirmation that something the user did has worked: "Giving strategy saved".
 *
 * Success only. A failure stays an `ErrorNote` beside the control that failed, because
 * the user has to act on it and a toast disappears. A toast is for the case where the
 * screen otherwise gives no sign anything happened, which is what a foundation reported
 * on the giving strategy: a Save button whose label flickered for two seconds read as
 * a button that did nothing.
 *
 * Call `toast('…')` from anywhere; `<Toaster />` is mounted once, in the authenticated
 * shell. A module-level store rather than a context, so a server-fn handler deep in a
 * dialog does not need a provider threaded down to it.
 */

type ToastItem = { id: number; message: string }

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

export function toast(message: string) {
  const id = nextId++
  // The newest on top, and at most three: a burst of saves should not build a tower.
  items = [{ id, message }, ...items].slice(0, 3)
  emit()
  setTimeout(() => dismiss(id), DURATION_MS)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = () => items
const getServerSnapshot = (): ToastItem[] => []

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

function ToastCard({ item }: { item: ToastItem }) {
  // Mounted at rest, then moved in, so the card slides rather than appearing.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-start gap-2 rounded-card border bg-white px-3 py-2.5 font-display text-body shadow-lg transition duration-200 ${
        shown ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
      }`}
      style={{ borderColor: C.line, color: C.ink }}
    >
      <HugeiconsIcon
        icon={Tick02Icon}
        size={16}
        strokeWidth={2}
        color={C.success}
        className="mt-0.5 shrink-0"
      />
      <span className="flex-1">{item.message}</span>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label="Dismiss"
        className="mt-0.5 shrink-0 rounded-chip hover:opacity-70"
        style={{ color: C.faint }}
      >
        <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
      </button>
    </div>
  )
}
