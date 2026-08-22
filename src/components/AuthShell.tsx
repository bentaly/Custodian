import type { ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import type { IconSvgElement } from '@hugeicons/react'
import {
  AiMagicIcon,
  HeartHandshakeIcon,
  Shield01Icon,
  StarAward02Icon,
} from '@hugeicons/core-free-icons'
import { LogoMark } from './ui/LogoMark'
import { AREA_ICON } from './Sidebar'

/**
 * Split layout for the signed-out screens: brand panel one side, form the other.
 *
 * The form comes first in the DOM and the panel is placed to its left with
 * `lg:flex-row-reverse`. That keeps reading and tab order on the form — which is the
 * only thing anyone came here to do — while below `lg` the panel simply falls beneath
 * it, so a phone gets the sign-in form on first paint and the product copy after,
 * rather than a screen of marketing to scroll past.
 *
 * The panel walks the six stages of the grant lifecycle in order, then makes three
 * claims about the whole of it. Copy is the 16 Aug 2026 revision; the layout is
 * Figma 827:1406.
 */

/**
 * The lifecycle, in the order the app itself is arranged.
 *
 * Each stage is marked with the AREA icon of the screen it becomes once you are signed
 * in — read from `AREA_ICON` rather than picked here, so the promise on this page and
 * the rail behind it can never drift apart. The comp numbers the rows 1–6; the icons
 * replace the numerals, and the order still carries (hence `<ol>`).
 *
 * Partnerships is the exception: the screen does not exist yet, so its glyph comes
 * straight from the design that will introduce it (Figma 709:55, `heart-handshake`)
 * and is NOT added to the rail.
 */
const STAGES = [
  {
    title: 'Applications',
    icon: AREA_ICON['/applications']!,

    body: "Inbound applications land in one queue — eligibility, due diligence and AI scoring handled as they arrive, with the AI's working shown for every score.",
  },
  {
    title: 'Partnerships',
    icon: HeartHandshakeIcon,

    body: 'For foundations sourcing grantees, prospective partners are logged, with eligibility, alignment and due diligence performed by AI.',
  },
  {
    title: 'Trustee voting',
    icon: AREA_ICON['/shortlist']!,

    body: 'Proposals, shortlists and board papers in one place. Trustees read, vote and comment in a single view, with AI summaries distilling each proposal to its essentials.',
  },
  {
    title: 'Reporting',
    icon: AREA_ICON['/reports']!,

    body: 'Grantee submissions are assessed with AI and tracked against schedule, with overdue reports flagged automatically.',
  },
  {
    title: 'Finance',
    icon: AREA_ICON['/finance']!,

    body: 'Payment schedules run end to end, with every approval and regulatory step logged. Grantee bank details are validated, and any inconsistencies flagged. Giving budgets are reconciled with balances.',
  },
  {
    title: 'Portfolio insight',
    icon: AREA_ICON['/insights']!,
    body: 'Outcomes, themes and impact measured across the entire giving portfolio — mapped against deprivation indices and geographic reach.',
  },
]

/**
 * What is true of all six stages at once, which is why these sit below the list rather
 * than inside it. The lead clause is the claim; the rest is what backs it up.
 */
const NOTES: { icon: IconSvgElement; lead?: string; body: ReactNode }[] = [
  {
    icon: AiMagicIcon,
    lead: 'AI runs through all stages.',
    body: 'It shows its reasoning as it reads, scores, summarises and checks. Final decisions remain with your team.',
  },
  {
    icon: Shield01Icon,
    lead: 'Audit-ready by default.',
    body: 'Every decision, payment and report leaves a complete, timestamped trail — so compliance checks, board scrutiny and regulator requests are answered from a single source of truth.',
  },
  {
    icon: StarAward02Icon,
    body: (
      <>
        Designed by a foundation chief executive and trustee with 20 years' experience, built by a
        leading cyber security engineer, and developed with{' '}
        <strong className="font-medium text-grey-900">national foundations</strong>.
      </>
    ),
  },
]

function Wordmark({ size = 'lg' }: { size?: 'lg' | 'sm' }) {
  return (
    <div className="flex items-center gap-2">
      <LogoMark className={size === 'lg' ? 'h-10 w-10' : 'h-9 w-9'} />
      <span className="text-heading font-semibold tracking-tight text-grey-900">Custodian</span>
    </div>
  )
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white lg:flex-row-reverse">
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[380px]">
          <div className="mb-8 lg:hidden">
            <Wordmark size="sm" />
          </div>
          {children}
        </div>
      </main>

      {/* Two-column: a fixed-width column that scrolls within itself if `compact:`
          can't shrink the copy enough. Stacked: full width, flowing with the page. */}
      <aside className="relative flex w-full shrink-0 flex-col border-t border-brand/20 bg-brand/5 px-6 py-10 lg:w-[52%] lg:max-w-[860px] lg:overflow-y-auto lg:border-t-0 lg:border-r lg:p-10 2xl:p-14 compact:p-7">
        {/* The dotted grid from behind the dashboard's giving chart. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(var(--color-grey-300) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        />

        <div className="relative flex flex-1 flex-col">
          {/* Stacked, the form above has already shown the wordmark. */}
          <div className="hidden lg:block">
            <Wordmark />
          </div>

          {/* The one deliberate exception to the type ramp. The comp sets this at a flat
              40px, which is right at the width it was drawn to — but the panel is a
              percentage of the viewport, so it must also survive a 1024px display and a
              short one. It therefore scales fluidly and tops out at the comp's 40px,
              which no fixed ramp step could do. */}
          <h2
            className="font-display max-w-[21ch] text-[clamp(28px,2.6vw,40px)] font-semibold leading-[1.2] text-grey-900 lg:mt-6 compact:mt-5 compact:text-[clamp(26px,2.3vw,34px)]"
            style={{ letterSpacing: '-0.02em', textWrap: 'pretty' }}
          >
            The entire grant lifecycle for the whole foundation team.
          </h2>

          {/* Hairlines BETWEEN the stages only: the list is a run of copy, not a boxed
              table, so it has no outer rules. */}
          <ol className="mt-7 divide-y divide-grey-200 compact:mt-5">
            {STAGES.map((stage) => (
              <li
                key={stage.title}
                className="grid grid-cols-[24px_1fr] gap-3 py-4 first:pt-0 last:pb-0 compact:py-2.5"
              >
                <span
                  aria-hidden
                  className="flex h-6 w-6 items-center justify-center rounded-chip border border-brand/20 bg-brand/10 text-brand"
                >
                  <HugeiconsIcon icon={stage.icon} className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <div>
                  <span className="text-title font-medium text-grey-900">{stage.title}</span>
                  <p
                    className="mt-1 text-body leading-[1.5] text-grey-500"
                    style={{ textWrap: 'pretty' }}
                  >
                    {stage.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-6 space-y-3 compact:mt-4 compact:space-y-2">
            {NOTES.map((note, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-control border border-brand/20 bg-brand/10 p-2"
              >
                <span
                  aria-hidden
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-chip bg-brand/10 text-brand"
                >
                  <HugeiconsIcon icon={note.icon} className="h-5 w-5" strokeWidth={1.5} />
                </span>
                <p className="text-body leading-[1.5] text-grey-500" style={{ textWrap: 'pretty' }}>
                  {note.lead && <strong className="font-medium text-grey-900">{note.lead} </strong>}
                  {note.body}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-auto pt-6 text-center text-body text-grey-500 compact:pt-4">
            Custodian is invite-only. Your administrator can send you an invitation.
          </p>
        </div>
      </aside>
    </div>
  )
}
