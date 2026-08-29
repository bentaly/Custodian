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
import { ExternalTextLink, TextLink } from './ui/TextLink'
import { cn } from './ui/cn'
import { AREA_ICON } from './Sidebar'

/**
 * Split layout for the signed-out screens: brand panel one side, form the other.
 *
 * The form comes first in the DOM & the panel is placed to its left with
 * `lg:flex-row-reverse`. That keeps reading & tab order on the form — which is the
 * only thing anyone came here to do — while below `lg` the panel simply falls beneath
 * it, so a phone gets the sign-in form on first paint & the product copy after,
 * rather than a screen of marketing to scroll past.
 *
 * The panel walks the six stages of the grant lifecycle, then makes three claims about
 * the whole of it. Layout is Figma 684:18; copy is the 23 Aug 2026 revision.
 */

/**
 * The lifecycle, drawn as a RING rather than a list (Figma 684:60).
 *
 * The ring is the argument: these six are one loop a foundation goes round every year,
 * not six features in a rank order. A numbered column said the opposite, & said it
 * with the last stage looking least important.
 *
 * Each stage is marked with the AREA icon of the screen it becomes once you are signed
 * in — read from `AREA_ICON` rather than picked here, so the promise on this page and
 * the rail behind it can never drift apart. Partnerships is the exception: the screen
 * does not exist yet, so its glyph comes straight from the design that will introduce
 * it (Figma 709:55, `heart-handshake`) & is NOT added to the rail.
 *
 * DOM order is the lifecycle order — it is what a screen reader & a keyboard get.
 * `place` then puts each one at its clock position, which is why every stage names its
 * row explicitly: the visual order (clockwise from 12) is not the DOM order.
 */
const STAGES = [
  {
    title: 'Applications',
    icon: AREA_ICON['/applications']!,
    body: 'Submissions scored & assessed for due diligence by AI.',
    place: 'md:col-start-1 md:col-span-3 md:row-start-1 md:justify-self-center md:max-w-[300px]',
  },
  {
    title: 'Partnerships',
    icon: HeartHandshakeIcon,
    body: 'Sourced grantees screened by AI for alignment & due diligence.',
    place: 'md:col-start-3 md:row-start-2 md:justify-self-start',
  },
  {
    title: 'Trustee voting',
    icon: AREA_ICON['/shortlist']!,
    body: 'AI brief lets trustees read, comment & vote in one view.',
    place: 'md:col-start-3 md:row-start-3 md:justify-self-start',
  },
  {
    title: 'Reporting',
    icon: AREA_ICON['/reports']!,
    body: 'Reports assessed by AI, schedules tracked & overdue submissions flagged.',
    place: 'md:col-start-1 md:col-span-3 md:row-start-4 md:justify-self-center md:max-w-[300px]',
  },
  {
    title: 'Finance',
    icon: AREA_ICON['/finance']!,
    body: 'Payment tracked, bank details verified, balances & budgets reconciled.',
    place: 'md:col-start-1 md:row-start-3 md:justify-self-end',
  },
  {
    title: 'Portfolio insight',
    icon: AREA_ICON['/insights']!,
    body: 'impact mapped against themes, deprivation & geographic reach.',
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
    body: 'AI shows its reasoning as it reads, scores, summarises & checks. Final decisions remain with your team.',
  },
  {
    icon: Shield01Icon,
    title: 'Audit-ready by default',
    body: 'Every decision, payment & report leaves a timestamped trail — for best practice governance & regulatory compliance.',
  },
  {
    icon: StarAward02Icon,
    title: 'Designed with foundations',
    body: (
      <>
        Designed by a foundation CEO & trustee with 20 years' experience, built by a leading cyber
        security engineer, developed with national foundations.
      </>
    ),
  },
]

/**
 * Where someone who cannot get in writes to us.
 *
 * NOT `FROM_EMAIL` (`noreply@custodian.fund`) — that is the address award letters are
 * sent FROM, and a no-reply box is the one place a register-of-interest must not land.
 */
const INTEREST_EMAIL = 'info@custodian.fund'

/**
 * The draft we put in their mail client, so "register interest" is a click and a Send
 * rather than a blank compose window & the job of working out what to ask for.
 *
 * Newlines survive `encodeURIComponent` as `%0A`, which every mail client renders as a
 * line break — so this is written as the letter it will become, blank lines & all.
 */
const INTEREST_BODY = `Hi,

I'm getting in touch to learn more about Custodian and how the platform supports grant-making foundations.
I'd be keen to understand the key features, pricing and implementation process, and would welcome the opportunity to arrange a demo.

Please let me know the best next step.

Many thanks,
`

function Wordmark({ size = 'lg' }: { size?: 'lg' | 'sm' }) {
  return (
    <div className="flex items-center gap-2">
      <LogoMark className={size === 'lg' ? 'h-10 w-10' : 'h-9 w-9'} />
      <span className="text-heading font-semibold tracking-tight text-grey-900">Custodian.</span>
    </div>
  )
}

/**
 * The ring the stages sit on: a dashed orbit, a soft brand wash at the hub, & the
 * mark at the centre of it.
 *
 * Purely decorative, so it is `aria-hidden` & hidden outright below `md`, where the
 * three-column grid collapses to a stack & a circle behind a column of chips would
 * be noise. Everything inside is sized as a PERCENTAGE of the ring, not in pixels, so
 * the whole assembly scales with the panel — which is a share of the viewport, not the
 * comp's fixed 815px.
 *
 * The diameter comes from the HEIGHT of the chip grid, inset by `inset-y-8` — roughly
 * half a chip — so the top & bottom points of the circle land INSIDE the Applications &
 * Reporting chips and the arc runs behind them, as it does in the comp. Sized off the
 * width instead, the circle sat wholly between the two rows and the arc closed above
 * Applications in plain sight, which is what made it read as a chip parked under a
 * circle rather than a stage sitting on a lifecycle.
 *
 * It measures the GRID rather than the spacing wrapper around it deliberately: while it
 * measured the wrapper, every pixel of breathing room added above Applications or below
 * Reporting also inflated the circle, so spacing and geometry could not be tuned
 * separately & the compact case had to run with almost no gap to keep the ring sane.
 */
function OrbitRing() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 inset-y-8 hidden place-items-center md:grid"
    >
      <div className="relative aspect-square h-full">
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

          Nearly two thirds, not half: the panel is carrying six stages & three cards,
          the form is carrying four fields — splitting the width evenly starves the side
          that has something to say & leaves the other one padding. The comp's own split
          is 56% (a 609px form column of a 1440px frame); this goes further, because the
          23 Aug copy runs longer than the one-line captions it was drawn around. The
          form needs 380px plus its gutters, so the ceiling is ~70% at 1440px.

          The gutter widens with the panel (32 → 40 → 48px), and the width goes 63% → 65%
          at `xl` to PAY for the last step rather than take it out of the content: at
          ~1580px the chip grid is already at its 800px cap, so the extra 2% becomes
          gutter & the three cards stop running out to the panel's edge while the ring
          above them sits inset — which is what read as cramped on a 1583×778 display.
          Padding alone would have narrowed the cards enough to rewrap them, & every line
          they gain is a line off the bottom of a panel that is already scrolling there.

          Two-column: the shell is pinned to the viewport (`lg:h-screen`) & this panel
          scrolls INSIDE itself, so a short display never pushes the form — the only
          thing anyone came here for — off the bottom of the page. `compact:` takes the
          first bite out of the spacing; the ring & the three cards are more copy than
          a 740px-tall laptop viewport holds, so past that it scrolls rather than being
          squeezed into illegibility. Stacked: full width, flowing with the page. */}
      <aside className="relative m-4 flex shrink-0 flex-col rounded-card border border-grey-100 bg-brand/5 p-8 lg:w-[63%] lg:px-10 xl:w-[65%] xl:px-12 lg:max-w-[1100px] lg:overflow-y-auto">
        {/* Stacked, the form above has already shown the wordmark. */}
        <div className="hidden lg:block">
          <Wordmark />
        </div>

        {/* The one deliberate exception to the type ramp. The comp sets this at a flat
            40px, which is right at the width it was drawn to — but the panel is a
            percentage of the viewport, so it must also survive a 1024px display & a
            short one. It therefore scales fluidly & tops out at the comp's 40px,
            which no fixed ramp step could do. */}
        <h2
          className="font-display mb-4 max-w-[21ch] text-[clamp(28px,2.6vw,40px)] font-semibold leading-[1.2] text-grey-900 lg:mt-5 compact:mb-3 compact:mt-2 compact:text-[clamp(26px,2.3vw,34px)]"
          style={{ letterSpacing: '-0.02em', textWrap: 'pretty' }}
        >
          The entire grant lifecycle for the whole foundation team.
        </h2>

        {/* The ring sits behind the stages & is centred on the whole block, so the
            top & bottom chips ride its arc exactly as they do in the comp. The side
            columns take the slack: the middle track is narrower than the ring, so the
            left & right chips overlap it rather than clearing it.

            The middle track is what sets how far the four side chips sit off the hub,
            and it is tuned so that gap MATCHES the one the top & bottom chips have —
            0.55fr put their inner edges flush against the pale disc while Applications
            & Reporting cleared it by ~34px, which read as the ring being squeezed from
            the sides. The dashed orbit still passes behind all six, as in the comp; it
            is the hub the chips are spaced off.

            `my-auto` gives the ring the slack: the heading holds the top, the cards &
            the invite-only line hold the bottom, and the ring is centred in whatever
            is left rather than hugging the heading with all the empty space beneath
            it. Auto margins collapse to nothing once the panel overflows, so the
            compact case just stacks — which is why the FLOOR on that gap is a fixed
            margin on the heading & on the cards below, not more padding here: this
            block's height is what sets the ring's diameter (see `OrbitRing`), so
            padding it would inflate the circle at exactly the sizes where there is
            already no room. Margins sit outside it & leave the geometry alone.

            `items-center` because a grid row stretches by default, & the two chips
            facing each other across the ring never carry the same number of lines —
            stretched, the shorter one grows to its neighbour's height & reads as a
            card padded out for no reason. Each chip is now its own height, & the pair
            balances on the row's midline, which is where the ring's symmetry puts
            them. */}
        <div className="mx-auto my-auto w-full max-w-[800px] py-4 compact:py-0">
          <div className="relative">
            <OrbitRing />
            <ol className="relative grid grid-cols-1 gap-4 md:grid-cols-[1fr_minmax(0,0.9fr)_1fr] md:items-center md:gap-x-3 md:gap-y-10 compact:gap-y-4">
              {STAGES.map((stage) => (
                <li
                  key={stage.title}
                  className={cn(
                    'flex items-center gap-2 rounded-control border border-grey-50/70 bg-white/10 py-2 pl-2 pr-3 backdrop-blur-[8px]',
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
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3 compact:gap-3">
          {NOTES.map((note) => (
            <div
              key={note.title}
              className="flex flex-col gap-3 rounded-control border border-grey-200 bg-grey-50 p-4 compact:p-3"
            >
              {/* Icon & title on one row: the tile is a label for the claim, not a
                  thing in its own right, & stacking them left a 40px square sitting
                  alone above a heading in every card. */}
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-chip bg-grey-100 text-grey-700"
                >
                  <HugeiconsIcon icon={note.icon} className="h-5 w-5" strokeWidth={1.5} />
                </span>
                <p className="text-title font-medium text-grey-900">{note.title}</p>
              </div>
              <p className="text-label leading-[1.5] text-grey-700" style={{ textWrap: 'pretty' }}>
                {note.body}
              </p>
            </div>
          ))}
        </div>

        {/* The two ways out of the only dead end on the page.
            This sentence is the sole line addressed to someone who CANNOT sign in, and
            until now it told them so and stopped — an invite-only product whose
            signed-out page has no answer for "then how do I get one?". So the links go
            here rather than in a corner: whoever has just read that they need an
            invitation is exactly the person who wants to read more or ask for one, and
            they are already looking at this line. */}
        <div className="pt-5 text-center compact:pt-1">
          <p className="text-body text-grey-500">
            Custodian is invite-only. Your administrator can send you an invitation.
          </p>
          <div className="mt-2 flex items-center justify-center gap-3 text-body">
            <TextLink to="/about">Learn more</TextLink>
            <span aria-hidden className="text-grey-300">
              ·
            </span>
            <ExternalTextLink
              href={`mailto:${INTEREST_EMAIL}?subject=${encodeURIComponent('Register interest in Custodian')}&body=${encodeURIComponent(INTEREST_BODY)}`}
            >
              Register interest
            </ExternalTextLink>
          </div>
        </div>
      </aside>
    </div>
  )
}
