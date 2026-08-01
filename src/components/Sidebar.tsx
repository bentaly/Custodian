import { useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import type { IconSvgElement } from '@hugeicons/react'
import {
  Award01Icon,
  BankIcon,
  Cancel01Icon,
  CheckListIcon,
  DashboardSquare01Icon,
  File01Icon,
  Files01Icon,
  Settings02Icon,
  TradeUpIcon,
} from '@hugeicons/core-free-icons'
import { LogoMark } from './ui/LogoMark'

// Values lifted directly from the Figma sidebar (node 126:31796). #637083 = Gray/500,
// #E4E7EC = Gray/200, #141C24 = Gray/900 — the real design variables, so matching them
// exactly now makes the eventual token swap a clean find-and-replace.
const itemClass =
  'flex items-center gap-3 rounded-xl p-3 text-[14px] font-medium text-[#637083] hover:bg-moss-50 hover:text-ink-soft [&.active]:bg-[#DFF3EA] [&.active]:text-[#1F7A5C]'

// One list, rendered twice — the desktop rail and the mobile drawer must never drift.
// `search` carries the round filter that the list screens require in their route search.
const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: DashboardSquare01Icon },
  { to: '/applications', label: 'Applications', icon: Files01Icon, search: { roundId: undefined } },
  { to: '/shortlist', label: 'Shortlist', icon: CheckListIcon, search: { roundId: undefined } },
  { to: '/reports', label: 'Reports', icon: File01Icon },
  { to: '/awards', label: 'Awards', icon: Award01Icon, search: { roundId: undefined } },
  { to: '/finance', label: 'Finance', icon: BankIcon },
  { to: '/insights', label: 'Insights', icon: TradeUpIcon },
] as const satisfies readonly {
  to: string
  label: string
  icon: IconSvgElement
  search?: { roundId: undefined }
}[]

// No `isAdmin` any more: every nav entry is now visible to every role, and the
// admin-only config it used to gate lives behind Settings, which filters itself.
function NavBody({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <nav className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            search={('search' in item ? item.search : undefined) as never}
            onClick={onNavigate}
            className={itemClass}
          >
            <HugeiconsIcon icon={item.icon} className="h-5 w-5" strokeWidth={1.75} />
            {item.label}
          </Link>
        ))}
      </nav>
      {/* Settings sits apart at the foot of the rail: it is where the app is
          configured (rounds, programmes, the team), not somewhere you work. Shown to
          everyone — the hub itself filters its cards by role. */}
      <div className="border-t border-[#E4E7EC] px-4 py-4">
        <Link to="/settings" onClick={onNavigate} className={itemClass}>
          <HugeiconsIcon icon={Settings02Icon} className="h-5 w-5" strokeWidth={1.75} />
          Settings
        </Link>
      </div>
    </>
  )
}

/**
 * The rail at `lg` and up; an off-canvas drawer below it, opened by the header's
 * burger. Both render the same `NavBody`. The drawer is always mounted so it can
 * slide rather than pop, and is `lg:hidden` so a desktop viewport never sees it even
 * if the open flag is somehow stale.
 */
export function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  // Escape closes, and the page behind must not scroll under the drawer.
  useEffect(() => {
    if (!mobileOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [mobileOpen, onClose])

  return (
    <>
      <aside className="hidden w-64 shrink-0 flex-col bg-[#FCFCFC] lg:flex">
        <div className="flex h-[74px] items-center gap-2 border-b border-[#E4E7EC] px-4">
          <LogoMark />
          <span className="text-[20px] font-semibold text-[#141C24]">Custodian</span>
        </div>
        <NavBody />
      </aside>

      <div
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-200 lg:hidden ${
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        id="mobile-nav"
        role="dialog"
        aria-modal="true"
        aria-label="Main navigation"
        // The drawer stays mounted so it can slide, so it must be taken out of the
        // tab order while closed — `aria-hidden` alone would still let a keyboard
        // user tab into off-screen links.
        inert={!mobileOpen}
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-[#FCFCFC] shadow-2xl transition-transform duration-300 ease-in-out lg:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-[74px] items-center gap-2 border-b border-[#E4E7EC] px-4">
          <LogoMark />
          <span className="text-[20px] font-semibold text-[#141C24]">Custodian</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="ml-auto flex size-9 items-center justify-center rounded-xl text-[#637083] hover:bg-[#F2F4F7]"
          >
            <HugeiconsIcon icon={Cancel01Icon} className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>
        <NavBody onNavigate={onClose} />
      </aside>
    </>
  )
}
