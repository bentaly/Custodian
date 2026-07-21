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

// Hard-coded palette lifted from the Figma dashboard design; swapped for theme
// tokens when the design system lands.
const itemClass =
  'flex items-center gap-3 rounded-xl px-4 py-3 text-[15px] font-medium text-[#5F6B76] hover:bg-[#F0F3F1] hover:text-[#3D4852] [&.active]:bg-[#DFF0E7] [&.active]:text-[#1C6B4F]'

function LogoMark() {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#DFF0E7]">
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
        <path
          d="M 17.2 7 A 7.5 7.5 0 1 0 17.2 17"
          fill="none"
          stroke="#17795A"
          strokeWidth="5"
        />
        <rect x="14.6" y="9.9" width="4.6" height="4.6" fill="#17795A" />
      </svg>
    </span>
  )
}

export function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-[#EDF0EF] bg-[#FAFBFA]">
      <div className="flex items-center gap-3 border-b border-[#EDF0EF] px-5 py-4">
        <LogoMark />
        <span className="text-[19px] font-bold tracking-tight text-[#101828]">Custodian</span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
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
