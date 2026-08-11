import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import type { IconSvgElement } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  Audit02Icon,
  Loading03Icon,
  MailOpenLoveIcon,
  Menu01Icon,
  NoteIcon,
  Search01Icon,
  UserMultipleIcon,
} from '@hugeicons/core-free-icons'
import { authClient } from '../lib/auth-client'
import { getRoundStatus } from '../lib/roundStatus'
import { globalSearch, type SearchResult, type SearchResultType } from '../server/fns/search'
import { Avatar, initials } from './ui'

type HeaderRound = {
  id: string
  name: string
  openedAt: Date | string | null
  closedAt: Date | string | null
}

type HeaderUser = {
  name: string
  image?: string | null
  clientName: string | null
}

function daysUntil(date: Date | string) {
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000)
}

function inDays(date: Date | string) {
  const days = daysUntil(date)
  if (days <= 0) return 'today'
  return days === 1 ? 'in 1 day' : `in ${days} days`
}

// "Spring 2026 closed · Summer 2027 opens in 11 days" — the most recently
// closed round in grey, then the live signal (open round / next opening) in green.
function roundStatusParts(rounds: HeaderRound[]) {
  const byStatus = rounds.map((r) => ({ ...r, status: getRoundStatus(r) }))

  const lastClosed = byStatus
    .filter((r) => r.status === 'closed' && r.closedAt)
    .sort((a, b) => new Date(b.closedAt!).getTime() - new Date(a.closedAt!).getTime())[0]
  const open = byStatus
    .filter((r) => r.status === 'open')
    .sort((a, b) => {
      if (!a.closedAt) return 1
      if (!b.closedAt) return -1
      return new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime()
    })[0]
  const nextUpcoming = byStatus
    .filter((r) => r.status === 'upcoming' && r.openedAt)
    .sort((a, b) => new Date(a.openedAt!).getTime() - new Date(b.openedAt!).getTime())[0]

  const grey = lastClosed ? `${lastClosed.name} closed` : null
  const green = open
    ? open.closedAt
      ? `${open.name} closes ${inDays(open.closedAt)}`
      : `${open.name} is open`
    : nextUpcoming
      ? `${nextUpcoming.name} opens ${inDays(nextUpcoming.openedAt!)}`
      : null

  return { grey, green }
}

const GROUPS: { type: SearchResultType; label: string; icon: IconSvgElement }[] = [
  // Same concepts as the sidebar rail, so the same icons — a result row and the
  // nav item it leads to must not be two different pictures of one thing.
  { type: 'application', label: 'Applications', icon: NoteIcon },
  { type: 'award', label: 'Awards', icon: MailOpenLoveIcon },
  { type: 'report', label: 'Reports', icon: Audit02Icon },
  { type: 'programme', label: 'Programmes', icon: UserMultipleIcon },
  { type: 'round', label: 'Rounds', icon: Search01Icon },
]

// A single dropdown row's link target, mapped from result type to its typed route.
function linkProps(r: SearchResult) {
  switch (r.type) {
    case 'application':
      return { to: '/applications/$applicationId', params: { applicationId: r.id } } as const
    case 'award':
      return { to: '/awards/$awardId', params: { awardId: r.id } } as const
    case 'report':
      return { to: '/reports/$reportKey', params: { reportKey: r.id } } as const
    case 'programme':
      return { to: '/programmes/$programmeId', params: { programmeId: r.id } } as const
    case 'round':
      // A round has no detail screen — it is edited in a dialog on the list, so search
      // can only land you on the list it lives in.
      return { to: '/rounds', params: {} } as const
  }
}

function GlobalSearch({
  isMac,
  hotkey = true,
  autoFocus = false,
  onDismiss,
}: {
  isMac: boolean
  /** Only the desktop instance binds ⌘K, so the two never fight over focus. */
  hotkey?: boolean
  autoFocus?: boolean
  /** Rendered as a "Cancel" affordance beside the field (the mobile overlay). */
  onDismiss?: () => void
}) {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  // Guards against out-of-order responses: only the latest request may set state.
  const reqId = useRef(0)

  useEffect(() => {
    if (!hotkey) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hotkey])

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  // Close when a click lands outside the search widget.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Debounced query — 200ms after the last keystroke.
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    const id = ++reqId.current
    const t = setTimeout(async () => {
      try {
        const res = await globalSearch({ data: { q } })
        if (id === reqId.current) {
          setResults(res)
          setActive(0)
          setOpen(true)
        }
      } catch {
        if (id === reqId.current) setResults([])
      } finally {
        if (id === reqId.current) setLoading(false)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [query])

  function go(r: SearchResult) {
    setOpen(false)
    setQuery('')
    setResults([])
    inputRef.current?.blur()
    onDismiss?.()
    navigate(linkProps(r))
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      // First escape closes the results; a second one dismisses the mobile overlay.
      if (!open && onDismiss) onDismiss()
      setOpen(false)
      inputRef.current?.blur()
      return
    }
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const r = results[active]
      if (r) go(r)
    }
  }

  const showDropdown = open && query.trim().length > 0
  // Flat list order must match the render order so `active` indexes correctly.
  const ordered = GROUPS.flatMap((g) => results.filter((r) => r.type === g.type))

  return (
    <div ref={containerRef} className="relative w-full lg:w-[320px]">
      <HugeiconsIcon
        icon={Search01Icon}
        strokeWidth={1.5}
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
      />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => query.trim() && setOpen(true)}
        onKeyDown={onInputKeyDown}
        placeholder="Search grants, partners, reports…"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls="global-search-listbox"
        autoComplete="off"
        className={`h-10 w-full rounded-control bg-gray-100 pl-9 text-body text-gray-900 placeholder:text-gray-500 focus:outline-hidden focus:ring-2 focus:ring-brand/25 ${onDismiss ? 'pr-10' : 'pr-14'}`}
      />
      {loading ? (
        <HugeiconsIcon
          icon={Loading03Icon}
          strokeWidth={1.5}
          className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-500"
        />
      ) : (
        // The shortcut badge is desktop-only chrome; the mobile overlay has a Cancel button instead.
        !onDismiss && (
          <kbd className="pointer-events-none absolute right-2 top-1/2 flex h-6 -translate-y-1/2 items-center rounded-chip bg-white px-2 text-label font-medium text-gray-900">
            {isMac ? '⌘K' : 'Ctrl+K'}
          </kbd>
        )
      )}

      {showDropdown && (
        <div
          id="global-search-listbox"
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-2 max-h-[70vh] w-104 max-w-[90vw] overflow-y-auto rounded-card border border-gray-200 bg-white py-2 shadow-xl"
        >
          {ordered.length === 0 && !loading && (
            <p className="px-4 py-6 text-center text-body text-gray-400">
              No results for “{query.trim()}”
            </p>
          )}
          {GROUPS.map((group) => {
            const rows = results.filter((r) => r.type === group.type)
            if (rows.length === 0) return null
            return (
              <div key={group.type} className="py-1">
                <p className="px-4 pb-1 pt-1 text-label font-semibold uppercase tracking-wide text-gray-400">
                  {group.label}
                </p>
                {rows.map((r) => {
                  const idx = ordered.indexOf(r)
                  const isActive = idx === active
                  return (
                    <Link
                      key={`${r.type}-${r.id}`}
                      {...linkProps(r)}
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setActive(idx)}
                      onClick={(e) => {
                        // Let ⌘/Ctrl/Shift-click open in a new tab; only intercept a plain click.
                        if (e.metaKey || e.ctrlKey || e.shiftKey) {
                          setOpen(false)
                          return
                        }
                        go(r)
                      }}
                      className={`flex items-center gap-3 px-4 py-2 ${isActive ? 'bg-gray-100' : ''}`}
                    >
                      <HugeiconsIcon
                        icon={group.icon}
                        strokeWidth={1.5}
                        className="h-4 w-4 shrink-0 text-gray-400"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium text-gray-900">
                          {r.title}
                        </span>
                        {r.subtitle && (
                          <span className="block truncate text-label text-gray-400">
                            {r.subtitle}
                          </span>
                        )}
                      </span>
                      {r.badge && (
                        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-label font-medium text-gray-500">
                          {r.badge}
                        </span>
                      )}
                    </Link>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function AppHeader({
  user,
  rounds,
  onOpenNav,
}: {
  user: HeaderUser
  rounds: HeaderRound[]
  /** Opens the off-canvas nav; the burger only shows below `lg`. */
  onOpenNav: () => void
}) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const { grey, green } = roundStatusParts(rounds)

  // SSR renders the Mac badge; corrected on mount for other platforms.
  const [isMac, setIsMac] = useState(true)
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform))
  }, [])

  const [signingOut, setSigningOut] = useState(false)
  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await authClient.signOut()
      navigate({ to: '/sign-in' })
    } finally {
      setSigningOut(false)
    }
  }

  const orgName = user.clientName ?? 'Custodian Platform'

  return (
    <header className="relative flex h-[74px] shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 sm:gap-4 sm:px-4">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onOpenNav}
          aria-label="Open navigation"
          aria-controls="mobile-nav"
          className="-ml-1 flex size-10 shrink-0 items-center justify-center rounded-control text-gray-900 hover:bg-gray-100 lg:hidden"
        >
          <HugeiconsIcon icon={Menu01Icon} strokeWidth={1.75} className="h-6 w-6" />
        </button>

        {/* Org switcher — Figma 126:31875. Below `sm` the name is dropped and only the
            initials tile survives; the burger and search need the room more. */}
        <div className="flex min-w-0 items-center gap-2 rounded-control border border-gray-200 bg-white p-1 sm:pr-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-chip bg-gray-100 text-body font-semibold text-gray-900">
            {initials(orgName)}
          </span>
          <span className="hidden truncate text-body font-medium text-gray-900 sm:block">
            {orgName}
          </span>
        </div>

        <div className="hidden lg:block">
          <GlobalSearch isMac={isMac} />
        </div>
      </div>

      {/* Below `lg` search is a single icon that expands over the whole bar — the field
          needs the full width to be usable, and the bar has none to spare. */}
      {searchOpen && (
        <div className="absolute inset-y-0 left-3 right-3 z-30 flex items-center gap-2 bg-white lg:hidden">
          <GlobalSearch
            isMac={isMac}
            hotkey={false}
            autoFocus
            onDismiss={() => setSearchOpen(false)}
          />
          <button
            type="button"
            onClick={() => setSearchOpen(false)}
            className="shrink-0 text-body font-medium text-gray-500"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          aria-label="Search"
          className="flex size-10 items-center justify-center rounded-control text-gray-500 hover:bg-gray-100 lg:hidden"
        >
          <HugeiconsIcon icon={Search01Icon} strokeWidth={1.75} className="h-5 w-5" />
        </button>

        {(grey || green) && (
          <p className="hidden whitespace-nowrap text-label font-medium lg:block">
            {grey && <span className="text-gray-400">{grey}</span>}
            {grey && green && <span className="text-gray-400"> · </span>}
            {green && <span className="text-brand">{green}</span>}
          </p>
        )}

        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-1 rounded-pill border border-gray-200 bg-white py-1 pl-1 pr-2 hover:bg-gray-50"
          >
            <Avatar name={user.name} image={user.image} />
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              strokeWidth={1.5}
              className="h-4 w-4 text-gray-500"
            />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-2 w-44 rounded-control border border-gray-200 bg-white py-1.5 shadow-lg">
                <Link
                  to="/profile"
                  onClick={() => setMenuOpen(false)}
                  className="block px-4 py-2 text-body text-gray-700 hover:bg-surface"
                >
                  Profile
                </Link>
                <button
                  onClick={handleSignOut}
                  className="block w-full px-4 py-2 text-left text-body text-gray-700 hover:bg-surface"
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
