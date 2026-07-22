import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Award01Icon,
  Building02Icon,
  Calendar03Icon,
  CheckListIcon,
  DashboardSquare01Icon,
  File01Icon,
  Files01Icon,
  Target01Icon,
  TradeUpIcon,
} from '@hugeicons/core-free-icons'

// Values lifted directly from the Figma sidebar (node 126:31796). #637083 = Gray/500,
// #E4E7EC = Gray/200, #141C24 = Gray/900 — the real design variables, so matching them
// exactly now makes the eventual token swap a clean find-and-replace.
const itemClass =
  'flex items-center gap-3 rounded-xl p-3 text-[14px] font-medium text-[#637083] hover:bg-[#F0F3F1] hover:text-[#3D4852] [&.active]:bg-[#DFF3EA] [&.active]:text-[#1F7A5C]'

// Exact logo mark from Figma (node 126:31799) — the chip background is baked into the SVG.
function LogoMark() {
  return (
    <svg viewBox="0 0 40 40" fill="none" className="h-10 w-10" aria-hidden>
      <rect width="40" height="40" rx="10" fill="#DFF3EA" />
      <path
        d="M20 29C18.22 29 16.4799 28.4722 14.9999 27.4832C13.5198 26.4943 12.3663 25.0887 11.6851 23.4442C11.0039 21.7996 10.8257 19.99 11.1729 18.2442C11.5202 16.4984 12.3774 14.8947 13.636 13.636C14.8947 12.3774 16.4984 11.5202 18.2442 11.1729C19.99 10.8257 21.7996 11.0039 23.4442 11.6851C25.0887 12.3663 26.4943 13.5198 27.4832 14.9999C28.4722 16.4799 29 18.22 29 20"
        stroke="#1F7A5C"
        strokeWidth="6"
      />
      <rect x="26" y="26" width="6" height="6" fill="#1F7A5C" />
    </svg>
  )
}

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
