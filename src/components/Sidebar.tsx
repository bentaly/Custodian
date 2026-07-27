import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Award01Icon,
  BankIcon,
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

// No `isAdmin` any more: every nav entry is now visible to every role, and the
// admin-only config it used to gate lives behind Settings, which filters itself.
export function Sidebar() {
  return (
    <aside className="flex w-64 shrink-0 flex-col bg-[#FCFCFC]">
      <div className="flex h-[74px] items-center gap-2 border-b border-[#E4E7EC] px-4">
        <LogoMark />
        <span className="text-[20px] font-semibold text-[#141C24]">Custodian</span>
      </div>
      <nav className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        <Link to="/dashboard" className={itemClass}>
          <HugeiconsIcon icon={DashboardSquare01Icon} className="h-5 w-5" strokeWidth={1.75} />
          Dashboard
        </Link>
        <Link to="/applications" search={{ roundId: undefined }} className={itemClass}>
          <HugeiconsIcon icon={Files01Icon} className="h-5 w-5" strokeWidth={1.75} />
          Applications
        </Link>
        <Link to="/shortlist" search={{ roundId: undefined }} className={itemClass}>
          <HugeiconsIcon icon={CheckListIcon} className="h-5 w-5" strokeWidth={1.75} />
          Shortlist
        </Link>
        <Link to="/reports" className={itemClass}>
          <HugeiconsIcon icon={File01Icon} className="h-5 w-5" strokeWidth={1.75} />
          Reports
        </Link>
        <Link to="/awards" search={{ roundId: undefined }} className={itemClass}>
          <HugeiconsIcon icon={Award01Icon} className="h-5 w-5" strokeWidth={1.75} />
          Awards
        </Link>
        <Link to="/finance" className={itemClass}>
          <HugeiconsIcon icon={BankIcon} className="h-5 w-5" strokeWidth={1.75} />
          Finance
        </Link>
        <Link to="/insights" className={itemClass}>
          <HugeiconsIcon icon={TradeUpIcon} className="h-5 w-5" strokeWidth={1.75} />
          Insights
        </Link>
      </nav>
      {/* Settings sits apart at the foot of the rail: it is where the app is
          configured (rounds, programmes, the team), not somewhere you work. Shown to
          everyone — the hub itself filters its cards by role. */}
      <div className="border-t border-[#E4E7EC] px-4 py-4">
        <Link to="/settings" className={itemClass}>
          <HugeiconsIcon icon={Settings02Icon} className="h-5 w-5" strokeWidth={1.75} />
          Settings
        </Link>
      </div>
    </aside>
  )
}
