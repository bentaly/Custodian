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
import { cn } from './ui/cn'
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
 * The panel walks the six stages of the grant lifecycle, then makes three claims about
 * the whole of it. Layout is Figma 684:18; copy is the 23 Aug 2026 revision.
 */

/**
 * The lifecycle, drawn as a RING rather than a list (Figma 684:60).
 *
 * The ring is the argument: these six are one loop a foundation goes round every year,
 * not six features in a rank order. A numbered column said the opposite, and said it
 * with the last stage looking least important.
 *
 * Each stage is marked with the AREA icon of the screen it becomes once you are signed
 * in — read from `AREA_ICON` rather than picked here, so the promise on this page and
 * the rail behind it can never drift apart. Partnerships is the exception: the screen
 * does not exist yet, so its glyph comes straight from the design that will introduce
 * it (Figma 709:55, `heart-handshake`) and is NOT added to the rail.
 *
 * DOM order is the lifecycle order — it is what a screen reader and a keyboard get.
 * `place` then puts each one at its clock position, which is why every stage names its
 * row explicitly: the visual order (clockwise from 12) is not the DOM order.
 */
const STAGES = [
  {
    title: 'Applications',
    icon: AREA_ICON['/applications']!,
    body: 'Submissions scored and assessed for due diligence by AI.',
    place: 'md:col-start-1 md:col-span-3 md:row-start-1 md:justify-self-center md:max-w-[300px]',
  },
  {
    title: 'Partnerships',
    icon: HeartHandshakeIcon,
    body: 'Sourced grantees screened by AI for alignment and due diligence.',
    place: 'md:col-start-3 md:row-start-2 md:justify-self-start',
  },
  {
    title: 'Trustee voting',
    icon: AREA_ICON['/shortlist']!,
    body: 'AI brief lets trustees read, comment and vote in one view.',
    place: 'md:col-start-3 md:row-start-3 md:justify-self-start',
  },
  {
    title: 'Reporting',
    icon: AREA_ICON['/reports']!,
    body: 'Reports assessed by AI, schedules tracked and overdue submissions flagged.',
    place: 'md:col-start-1 md:col-span-3 md:row-start-4 md:justify-self-center md:max-w-[300px]',
  },
  {
    title: 'Finance',
    icon: AREA_ICON['/finance']!,
    body: 'Payment schedules tracked and flagged, bank details verified, balances reconciled against budget.',
    place: 'md:col-start-1 md:row-start-3 md:justify-self-end',
  },
  {
    title: 'Portfolio insight',
    icon: AREA_ICON['/insights']!,
    body: 'Portfolio outcomes and impact analysed, mapped against themes, deprivation and geographic reach.',
    place: 'md:col-start-1 md:row-start-2 md:justify-self-end',
  },
]

/**
 * What is true of all six stages at once, which is why these sit below the ring rather
 * than on it.
 *
 * The 23 Aug copy opens the first line by repeating its own heading ("AI runs through
 * all stages. It shows its reasoning…"); the card already carries that as its title, so
 * the repeat is dropped rather than printed twice.
 */
const NOTES: { icon: IconSvgElement; title: string; body: ReactNode }[] = [
  {
    icon: AiMagicIcon,
    title: 'AI runs through all stages',
    body: 'It shows its reasoning as it reads, scores, summarises and checks. Final decisions remain with your team.',
  },
  {
    icon: Shield01Icon,
    title: 'Audit-ready by default',
    body: 'Every decision, payment and report leaves a complete, timestamped trail — so compliance checks, board scrutiny and regulator requests are answered from a single source of truth.',
  },
  {
    icon: StarAward02Icon,
    title: 'Designed with foundations',
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

/**
 * The ring the stages sit on: a dashed orbit, a soft brand wash at the hub, and the
 * mark at the centre of it.
 *
 * Purely decorative, so it is `aria-hidden` and hidden outright below `md`, where the
 * three-column grid collapses to a stack and a circle behind a column of chips would
 * be noise. Everything inside is sized as a PERCENTAGE of the ring, not in pixels, so
 * the whole assembly scales with the panel — which is a share of the viewport, not the
 * comp's fixed 815px.
 */
function OrbitRing() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 hidden place-items-center md:grid"
    >
      <div className="relative aspect-square w-[52%]">
        <svg viewBox="0 0 100 100" className="h-full w-full">
          <circle
            cx="50"
            cy="50"
            r="49.5"
            fill="none"
            stroke="var(--color-grey-300)"
            strokeWidth="0.3"
            strokeDasharray="1.2 1.8"
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div
            className="grid aspect-square w-[47%] place-items-center rounded-full"
            style={{
              backgroundImage:
                'linear-gradient(180deg, color-mix(in srgb, var(--color-brand) 6%, transparent), transparent)',
            }}
          >
            <LogoMark withChip={false} className="w-[34%]" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background lg:h-screen lg:flex-row-reverse lg:overflow-hidden">
      <main className="flex flex-1 items-center justify-center px-6 py-12 lg:overflow-y-auto">
        <div className="w-full max-w-[380px]">
          <div className="mb-8 lg:hidden">
            <Wordmark size="sm" />
          </div>
          {children}
        </div>
      </main>

      {/* An inset card rather than a full-bleed column (the comp insets it 16px on every
          side).

          Two-column: the shell is pinned to the viewport (`lg:h-screen`) and this panel
          scrolls INSIDE itself, so a short display never pushes the form — the only
          thing anyone came here for — off the bottom of the page. `compact:` takes the
          first bite out of the spacing; the ring and the three cards are more copy than
          a 740px-tall laptop viewport holds, so past that it scrolls rather than being
          squeezed into illegibility. Stacked: full width, flowing with the page. */}
      <aside className="relative m-4 flex shrink-0 flex-col rounded-card border border-grey-100 bg-brand/5 p-6 lg:w-[52%] lg:max-w-[860px] lg:overflow-y-auto lg:p-10 2xl:p-14 compact:p-7">
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
          className="font-display max-w-[21ch] text-[clamp(28px,2.6vw,40px)] font-semibold leading-[1.2] text-grey-900 lg:mt-5 compact:mt-4 compact:text-[clamp(26px,2.3vw,34px)]"
          style={{ letterSpacing: '-0.02em', textWrap: 'pretty' }}
        >
          The entire grant lifecycle for the whole foundation team.
        </h2>

        {/* The ring sits behind the stages and is centred on the whole block, so the
            top and bottom chips ride its arc exactly as they do in the comp. The side
            columns take the slack: the middle track is narrower than the ring, so the
            left and right chips overlap it rather than clearing it.

            `items-center` because a grid row stretches by default, and the two chips
            facing each other across the ring never carry the same number of lines —
            stretched, the shorter one grows to its neighbour's height and reads as a
            card padded out for no reason. Each chip is now its own height, and the pair
            balances on the row's midline, which is where the ring's symmetry puts
            them. */}
        <div className="relative mx-auto my-4 w-full max-w-[640px] compact:my-3">
          <OrbitRing />
          <ol className="relative grid grid-cols-1 gap-4 md:grid-cols-[1fr_minmax(0,0.55fr)_1fr] md:items-center md:gap-x-3 md:gap-y-6 compact:gap-y-4">
            {STAGES.map((stage) => (
              <li
                key={stage.title}
                className={cn(
                  'flex items-center gap-2 rounded-control border border-white bg-white/60 py-2 pl-2 pr-3 backdrop-blur-[8px]',
                  stage.place,
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-chip bg-white text-brand">
                  <HugeiconsIcon icon={stage.icon} className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <div>
                  <span className="text-title font-medium text-grey-900">{stage.title}</span>
                  <p
                    className="mt-1 text-label leading-[1.4] text-grey-500"
                    style={{ textWrap: 'pretty' }}
                  >
                    {stage.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-auto grid gap-4 sm:grid-cols-3 compact:gap-3">
          {NOTES.map((note) => (
            <div
              key={note.title}
              className="flex flex-col gap-3 rounded-control border border-grey-200 bg-grey-50 p-4"
            >
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-chip bg-grey-100 text-grey-700"
              >
                <HugeiconsIcon icon={note.icon} className="h-5 w-5" strokeWidth={1.5} />
              </span>
              <div className="space-y-2">
                <p className="text-title font-medium text-grey-900">{note.title}</p>
                <p className="text-body leading-[1.5] text-grey-700" style={{ textWrap: 'pretty' }}>
                  {note.body}
                </p>
              </div>
            </div>
          ))}
        </div>

        <p className="pt-5 text-center text-body text-grey-500 compact:pt-3">
          Custodian is invite-only. Your administrator can send you an invitation.
        </p>
      </aside>
    </div>
  )
}
