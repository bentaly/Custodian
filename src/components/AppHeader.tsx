import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import type { IconSvgElement } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  ChampionIcon,
  File01Icon,
  Layers01Icon,
  Loading03Icon,
  Search01Icon,
  UserMultipleIcon,
} from '@hugeicons/core-free-icons'
import { authClient } from '../lib/auth-client'
import { getRoundStatus } from '../lib/roundStatus'
import { globalSearch, type SearchResult, type SearchResultType } from '../server/fns/search'

type HeaderRound = {
  id: string
  name: string
  openedAt: Date | string | null
  closedAt: Date | string | null
}

type HeaderUser = {
  name: string
  clientName: string | null
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
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
  { type: 'application', label: 'Applications', icon: File01Icon },
  { type: 'award', label: 'Awards', icon: ChampionIcon },
  { type: 'report', label: 'Reports', icon: Layers01Icon },
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
      return { to: '/rounds/$roundId', params: { roundId: r.id } } as const
  }
}

function GlobalSearch({ isMac }: { isMac: boolean }) {
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
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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
    navigate(linkProps(r))
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
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
    <div ref={containerRef} className="relative w-full max-w-sm">
      <HugeiconsIcon
        icon={Search01Icon}
        strokeWidth={1.5}
        className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9AA3AD]"
      />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => query.trim() && setOpen(true)}
        onKeyDown={onInputKeyDown}
        placeholder="Search applications, awards, reports…"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls="global-search-listbox"
        autoComplete="off"
        className="w-full rounded-full bg-[#F1F3F5] py-2.5 pl-10 pr-14 text-sm text-[#101828] placeholder:text-[#9AA3AD] focus:outline-none focus:ring-2 focus:ring-[#1D9E75]/30"
      />
      {loading ? (
        <HugeiconsIcon
          icon={Loading03Icon}
          strokeWidth={1.5}
          className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[#9AA3AD]"
        />
      ) : (
        <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-white px-1.5 py-0.5 text-xs text-[#6B7280] shadow-sm">
          {isMac ? '⌘K' : 'Ctrl+K'}
        </kbd>
      )}

      {showDropdown && (
        <div
          id="global-search-listbox"
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-2 max-h-[70vh] w-[26rem] max-w-[90vw] overflow-y-auto rounded-2xl border border-[#E4E7E6] bg-white py-2 shadow-xl"
        >
          {ordered.length === 0 && !loading && (
            <p className="px-4 py-6 text-center text-sm text-[#9AA3AD]">
              No results for “{query.trim()}”
            </p>
          )}
          {GROUPS.map((group) => {
            const rows = results.filter((r) => r.type === group.type)
            if (rows.length === 0) return null
            return (
              <div key={group.type} className="py-1">
                <p className="px-4 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-[#9AA3AD]">
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
                      className={`flex items-center gap-3 px-4 py-2 ${isActive ? 'bg-[#F0F6F3]' : ''}`}
                    >
                      <HugeiconsIcon icon={group.icon} strokeWidth={1.5} className="h-4 w-4 shrink-0 text-[#9AA3AD]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-[#101828]">
                          {r.title}
                        </span>
                        {r.subtitle && (
                          <span className="block truncate text-xs text-[#8A939D]">{r.subtitle}</span>
                        )}
                      </span>
                      {r.badge && (
                        <span className="shrink-0 rounded-full bg-[#F1F3F2] px-2 py-0.5 text-xs font-medium text-[#6B7280]">
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

export function AppHeader({ user, rounds }: { user: HeaderUser; rounds: HeaderRound[] }) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const { grey, green } = roundStatusParts(rounds)

  // SSR renders the Mac badge; corrected on mount for other platforms.
  const [isMac, setIsMac] = useState(true)
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform))
  }, [])

  async function handleSignOut() {
    await authClient.signOut()
    navigate({ to: '/sign-in' })
  }

  const orgName = user.clientName ?? 'Custodian Platform'

  return (
    <header className="flex items-center gap-4 border-b border-[#EDF0EF] bg-white px-6 py-3">
      <div className="flex items-center gap-2.5 rounded-xl border border-[#E4E7E6] px-3 py-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#F1F3F2] text-xs font-semibold text-[#4B5563]">
          {initials(orgName)}
        </span>
        <span className="text-[15px] font-semibold text-[#101828]">{orgName}</span>
      </div>

      <GlobalSearch isMac={isMac} />

      <div className="flex-1" />

      {(grey || green) && (
        <p className="hidden whitespace-nowrap text-sm lg:block">
          {grey && <span className="text-[#8A939D]">{grey}</span>}
          {grey && green && <span className="text-[#8A939D]"> · </span>}
          {green && <span className="font-medium text-[#1D9E75]">{green}</span>}
        </p>
      )}

      <div className="relative">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-full p-1 hover:bg-[#F0F3F1]"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#DFF0E7] text-xs font-semibold text-[#1C6B4F]">
            {initials(user.name)}
          </span>
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={1.5} className="h-4 w-4 text-[#9AA3AD]" />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-full z-20 mt-2 w-44 rounded-xl border border-[#E4E7E6] bg-white py-1.5 shadow-lg">
              <Link
                to="/profile"
                onClick={() => setMenuOpen(false)}
                className="block px-4 py-2 text-sm text-[#374151] hover:bg-[#F5F7F6]"
              >
                Profile
              </Link>
              <button
                onClick={handleSignOut}
                className="block w-full px-4 py-2 text-left text-sm text-[#374151] hover:bg-[#F5F7F6]"
              >
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  )
}
