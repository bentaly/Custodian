import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronDown, Search } from 'lucide-react'
import { authClient } from '../lib/auth-client'
import { getRoundStatus } from '../lib/roundStatus'

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

export function AppHeader({ user, rounds }: { user: HeaderUser; rounds: HeaderRound[] }) {
  const navigate = useNavigate()
  const searchRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const { grey, green } = roundStatusParts(rounds)

  // SSR renders the Mac badge; corrected on mount for other platforms.
  const [isMac, setIsMac] = useState(true)
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform))
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = searchRef.current?.value.trim()
    navigate({ to: '/applications', search: { q: q || undefined, roundId: undefined } })
  }

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

      <form onSubmit={handleSearchSubmit} className="relative w-full max-w-sm">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9AA3AD]" />
        <input
          ref={searchRef}
          type="search"
          placeholder="Search applications…"
          className="w-full rounded-full bg-[#F1F3F5] py-2.5 pl-10 pr-14 text-sm text-[#101828] placeholder:text-[#9AA3AD] focus:outline-none focus:ring-2 focus:ring-[#1D9E75]/30"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-white px-1.5 py-0.5 text-xs text-[#6B7280] shadow-sm">
          {isMac ? '⌘K' : 'Ctrl+K'}
        </kbd>
      </form>

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
          <ChevronDown className="h-4 w-4 text-[#9AA3AD]" />
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
