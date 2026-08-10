import type { ReactNode } from 'react'
import { LogoMark } from './ui/LogoMark'

/**
 * Split layout for the signed-out screens: brand panel one side, form the other.
 *
 * The form comes first in the DOM and the panel is placed to its left with
 * `lg:flex-row-reverse`. That keeps reading and tab order on the form — which is the
 * only thing anyone came here to do — while below `lg` the panel simply falls beneath
 * it, so a phone gets the sign-in form on first paint and the product copy after,
 * rather than a screen of marketing to scroll past.
 *
 * The panel walks the five stages of the grant lifecycle in order, which is also the
 * order of the app's own navigation, and says once — at the end — that AI runs through
 * all five rather than being bolted onto one.
 */

/** The lifecycle, in the order the app itself is arranged. */
const STAGES = [
  {
    title: 'Applications',
    badge: 'AI scoring',
    body: 'Intake, eligibility and due diligence in one queue — AI scores every application and shows its working.',
  },
  {
    title: 'Trustee voting',
    badge: 'AI briefs',
    body: 'Board papers, comments and votes in one place, each application opening with a plain-English AI brief.',
  },
  {
    title: 'Reporting',
    badge: 'AI summaries',
    body: 'Grantee reports arrive structured and chased automatically; AI pulls out the themes so nothing goes unread.',
  },
  {
    title: 'Payments',
    badge: 'AI checks',
    body: 'Schedules, approvals and bank verification tracked end to end, with AI flagging anything out of step before it leaves.',
  },
  {
    title: 'Portfolio insight',
    badge: 'Ask AI',
    body: 'Committed spend, reach and deprivation, live — ask a question of the whole portfolio and get a sourced answer.',
  },
]

function Wordmark({ size = 'lg' }: { size?: 'lg' | 'sm' }) {
  return (
    <div className="flex items-center gap-3">
      <LogoMark className={size === 'lg' ? 'h-11 w-11' : 'h-9 w-9'} />
      <span
        className={`font-semibold tracking-tight text-gray-900 ${size === 'lg' ? 'text-heading' : 'text-heading'}`}
      >
        Custodian
      </span>
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
            backgroundImage: 'radial-gradient(var(--color-gray-300) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        />

        <div className="relative flex flex-1 flex-col">
          {/* Stacked, the form above has already shown the wordmark. */}
          <div className="hidden lg:block">
            <Wordmark />
          </div>

          {/* The one deliberate exception to the type ramp. This is the signed-out brand
              panel — marketing copy, not product chrome, and the only screen with no
              Figma design. It scales fluidly with the viewport (and compacts again on a
              short one), which no fixed ramp step can do; pinning it to `text-display`
              would either overflow the panel or leave it undersized on a wide display. */}
          <h2
            className="font-display max-w-[21ch] text-[clamp(28px,2.7vw,42px)] font-semibold leading-[1.06] text-gray-900 lg:mt-8 compact:mt-6 compact:text-[clamp(26px,2.4vw,34px)]"
            style={{ letterSpacing: '-0.035em', textWrap: 'pretty' }}
          >
            The entire grant lifecycle, for the whole foundation team.
          </h2>

          <ol className="mt-8 compact:mt-6">
            {STAGES.map((stage, i) => (
              <li
                key={stage.title}
                className="grid grid-cols-[30px_1fr] gap-4 border-t border-brand/20 py-3.5 last:border-b compact:py-2.5"
              >
                <span
                  aria-hidden
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-chip bg-brand-secondary text-body font-bold text-brand"
                >
                  {i + 1}
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-title font-semibold tracking-tight text-gray-900">
                      {stage.title}
                    </span>
                    <span className="rounded-full bg-brand-secondary px-2 py-[3px] text-label font-bold uppercase tracking-[0.09em] text-brand">
                      {stage.badge}
                    </span>
                  </div>
                  <p
                    className="mt-1 text-body leading-[1.5] text-gray-500"
                    style={{ textWrap: 'pretty' }}
                  >
                    {stage.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-6 flex items-start gap-3.5 rounded-card border border-brand/20 bg-white p-4 compact:mt-4 compact:p-3.5">
            <span
              aria-hidden
              className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-chip bg-brand text-label font-extrabold tracking-wide text-white"
            >
              AI
            </span>
            <p className="text-body leading-[1.55] text-gray-500" style={{ textWrap: 'pretty' }}>
              <strong className="font-semibold text-gray-900">
                AI runs through all five stages, not bolted on to one.
              </strong>{' '}
              It reads, scores, summarises and checks — with every judgement traceable to the
              source. Your team still decides.
            </p>
          </div>

          <p className="mt-auto pt-6 text-body text-gray-500 compact:pt-4">
            Custodian is invite-only. Your administrator can send you an invitation.
          </p>
        </div>
      </aside>
    </div>
  )
}
