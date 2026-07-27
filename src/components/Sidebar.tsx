import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Award01Icon,
  BankIcon,
  Building02Icon,
  Calendar03Icon,
  CheckListIcon,
  DashboardSquare01Icon,
  File01Icon,
  Files01Icon,
  Target01Icon,
  TradeUpIcon,
} from '@hugeicons/core-free-icons'
import { LogoMark } from './ui/LogoMark'

// Values lifted directly from the Figma sidebar (node 126:31796). #637083 = Gray/500,
// #E4E7EC = Gray/200, #141C24 = Gray/900 — the real design variables, so matching them
// exactly now makes the eventual token swap a clean find-and-replace.
const itemClass =
  'flex items-center gap-3 rounded-xl p-3 text-[14px] font-medium text-[#637083] hover:bg-moss-50 hover:text-ink-soft [&.active]:bg-[#DFF3EA] [&.active]:text-[#1F7A5C]'

export function Sidebar({ isAdmin }: { isAdmin: boolean }) {
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
        <Link to="/rounds" className={itemClass}>
          <HugeiconsIcon icon={Calendar03Icon} className="h-5 w-5" strokeWidth={1.75} />
          Rounds
        </Link>
        <Link to="/programmes" className={itemClass}>
          <HugeiconsIcon icon={Target01Icon} className="h-5 w-5" strokeWidth={1.75} />
          Programmes
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
        {isAdmin && (
          <Link to="/users" className={itemClass}>
            <HugeiconsIcon icon={Building02Icon} className="h-5 w-5" strokeWidth={1.75} />
            Organisation
          </Link>
        )}
      </nav>
    </aside>
  )
}
