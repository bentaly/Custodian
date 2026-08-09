// ─── Admin UI kit ────────────────────────────────────────────────────────────
//
// Every screen in this app was styled ad hoc, so the same idea — a status, a
// destructive button, a warning — looked different on each one, and an operator had
// to re-learn each screen. These are the shared pieces. Deliberately small: this is
// an internal ops tool, and the job is legibility under stress, not decoration.
//
// One vocabulary rule runs through the lot: a submission's raw status enum
// (`needs_review`, `ai_proposed`, …) is a database word, not an instruction. Every
// place one is shown it is rendered through `StatusPill`, which says what it means
// for the person reading it and keeps the raw value in the tooltip for debugging.

import { useState, type ReactNode } from 'react'
import type { Blocker, IngestStatus } from './api'

// ─── Status vocabulary ───────────────────────────────────────────────────────

interface StatusMeta {
  /** What this status means to the operator, not what the column says. */
  label: string
  /** One line: what it is, and whether it wants anything from them. */
  meaning: string
  className: string
}

export const STATUS_META: Record<IngestStatus, StatusMeta> = {
  received: {
    label: 'Processing',
    meaning:
      'Stored safely; the background pipeline is mapping fields and running checks. Should clear in seconds — if it lingers, the run crashed.',
    className: 'border-slate-300 bg-slate-100 text-slate-600',
  },
  needs_review: {
    label: 'Held for you',
    meaning:
      'The pipeline could not finish on its own. Nothing was created; it waits here until a human resolves it.',
    className: 'border-amber-300 bg-amber-50 text-amber-800',
  },
  ai_proposed: {
    label: 'Auto-mapped',
    meaning:
      'The AI was confident enough that the record was created already. It is here so a human can agree the mapping was right.',
    className: 'border-sky-300 bg-sky-50 text-sky-800',
  },
  complete: {
    label: 'Done',
    meaning: 'Mapped, created, and confirmed. Kept for audit — no action needed.',
    className: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  },
}

export function StatusPill({ status, stalled }: { status: IngestStatus; stalled?: boolean }) {
  // A `received` row past its patience window is a different situation from one that
  // just arrived, even though the column holds the same value — so it gets its own pill.
  if (stalled && status === 'received') {
    return (
      <span
        title="Raw status: received. The background run has not finished and is past the point where waiting is reasonable."
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-rose-300 bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-800"
      >
        <span className="size-1.5 rounded-full bg-rose-500" />
        Stalled
      </span>
    )
  }
  const meta = STATUS_META[status]
  return (
    <span
      title={`Raw status: ${status}. ${meta.meaning}`}
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  )
}

// ─── Layout ──────────────────────────────────────────────────────────────────

export function Page({
  title,
  intro,
  actions,
  children,
}: {
  title: string
  intro?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {intro && <div className="mt-1.5 text-sm leading-relaxed text-slate-500">{intro}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-xs ${className}`}>
      {children}
    </div>
  )
}

export function SectionHeading({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{children}</h2>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center">
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {detail && <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">{detail}</p>}
    </div>
  )
}

export function Loading({ what = 'Loading' }: { what?: string }) {
  return (
    <p className="flex items-center gap-2 px-1 py-6 text-sm text-slate-400">
      <span className="size-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500" />
      {what}…
    </p>
  )
}

// ─── Callouts ────────────────────────────────────────────────────────────────

const CALLOUT_TONES = {
  info: 'border-slate-200 bg-slate-50 text-slate-700',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-rose-200 bg-rose-50 text-rose-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
} as const

export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: keyof typeof CALLOUT_TONES
  title?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className={`rounded-lg border px-3.5 py-3 text-xs leading-relaxed ${CALLOUT_TONES[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? 'mt-1 opacity-90' : ''}>{children}</div>}
    </div>
  )
}

// ─── Buttons ─────────────────────────────────────────────────────────────────

const BUTTON_VARIANTS = {
  primary:
    'bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:outline-indigo-600 border-transparent',
  secondary:
    'bg-white text-slate-700 border-slate-300 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-slate-400',
  danger:
    'bg-white text-slate-600 border-slate-300 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-rose-400',
  ghost:
    'border-transparent bg-transparent text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800 focus-visible:outline-indigo-400',
} as const

/**
 * `busy` disables and swaps the label, per the app-wide async-button convention —
 * a queue action that fires a background pipeline must never look idle mid-flight,
 * or an operator double-fires it and creates two applications from one submission.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  busy = false,
  busyLabel,
  disabled,
  children,
  ...rest
}: {
  variant?: keyof typeof BUTTON_VARIANTS
  size?: 'sm' | 'md'
  busy?: boolean
  busyLabel?: string
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm'
      } ${BUTTON_VARIANTS[variant]} ${rest.className ?? ''}`}
    >
      {busy && (
        <span className="size-3 animate-spin rounded-full border-2 border-current/30 border-t-current" />
      )}
      {busy ? (busyLabel ?? children) : children}
    </button>
  )
}

/**
 * An action with its consequence spelled out beside it, and its own outcome reported
 * underneath it.
 *
 * The queue's actions are not self-explanatory — "Reprocess" and "Resolve" both sound
 * like "make this go away", but one re-runs a pipeline and the other creates a live
 * application — and guessing wrong is not free.
 *
 * `error` and `notice` belong to the individual action rather than the card because a
 * single shared message box at the top of a long card puts the answer a scroll away
 * from the button that produced it: press Reprocess at the bottom of an open card and
 * "this submission has already been processed" appears somewhere above the fold, so
 * the button looks like it did nothing at all.
 */
export function Action({
  label,
  description,
  onClick,
  busy,
  busyLabel,
  variant = 'secondary',
  disabled,
  error,
  notice,
}: {
  label: string
  description: string
  onClick: () => void
  busy?: boolean
  busyLabel?: string
  variant?: keyof typeof BUTTON_VARIANTS
  disabled?: boolean
  error?: string | null
  notice?: string | null
}) {
  return (
    <div>
      <div className="flex items-start gap-3">
        <Button
          variant={variant}
          onClick={onClick}
          busy={busy}
          busyLabel={busyLabel}
          disabled={disabled}
          className="w-40"
        >
          {label}
        </Button>
        <p className="pt-1.5 text-xs leading-relaxed text-slate-500">{description}</p>
      </div>
      {(error || notice) && (
        <div className="mt-1.5 ml-[10.75rem]">
          <Callout tone={error ? 'danger' : 'success'}>{error ?? notice}</Callout>
        </div>
      )}
    </div>
  )
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      onClick={() => {
        navigator.clipboard?.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  )
}

// ─── Blockers ────────────────────────────────────────────────────────────────

const BLOCKER_TONE: Record<Blocker['severity'], keyof typeof CALLOUT_TONES> = {
  blocking: 'warn',
  info: 'info',
}

/**
 * The "why is this here" panel. The single most-requested thing in this app: a held
 * submission used to show a status word and a grid of dropdowns, and the operator had
 * to work out from that alone what had gone wrong and which of four buttons would fix
 * it. Each blocker states the problem, why the pipeline stopped, and what to do.
 */
export function BlockerPanel({ blockers }: { blockers: Blocker[] }) {
  if (blockers.length === 0) return null
  return (
    <div className="space-y-2">
      {blockers.map((b, i) => (
        <Callout key={`${b.code}-${i}`} tone={BLOCKER_TONE[b.severity]} title={b.title}>
          <p>{b.detail}</p>
          {b.fields && b.fields.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {b.fields.map((f) => (
                <li key={f.key} className="flex flex-wrap items-baseline gap-1.5">
                  <span className="rounded bg-white/70 px-1.5 py-0.5 font-medium">{f.label}</span>
                  {f.message && <span className="opacity-80">{f.message}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 font-medium">What to do: {b.fix}</p>
        </Callout>
      ))}
    </div>
  )
}

// ─── Form bits ───────────────────────────────────────────────────────────────

export const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-hidden placeholder:text-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500'

export function Labelled({
  label,
  hint,
  children,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

/** A raw payload, shown as sent. Collapsed by default — useful, but rarely first. */
export function PayloadViewer({ payload }: { payload: Record<string, unknown> }) {
  const [open, setOpen] = useState(false)
  const json = JSON.stringify(payload, null, 2)
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-xs font-medium text-slate-600 hover:text-slate-900"
        >
          {open ? '▾' : '▸'} Raw payload as submitted ({Object.keys(payload).length} fields)
        </button>
        {open && <CopyButton value={json} label="Copy JSON" />}
      </div>
      {open && (
        <pre className="max-h-72 overflow-auto border-t border-slate-200 px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-700">
          {json}
        </pre>
      )}
    </div>
  )
}
