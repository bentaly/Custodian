import { createFileRoute, Link, type LinkProps } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Building02Icon,
  Calendar03Icon,
  CoinsPoundIcon,
  Compass01Icon,
  DatabaseImportIcon,
  HistoryIcon,
  JudgeIcon,
  Key01Icon,
  Mail01Icon,
  PiggyBankIcon,
  PlugSocketIcon,
  SourceCodeIcon,
  Target01Icon,
  ThumbsUpDownIcon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import { C } from '../../components/ui/tokens'
import { canSeePayments } from '../../lib/roles'
import type { SettingsStatuses, TileStatus } from '../../lib/settingsStatus'
import { getSettingsStatuses } from '../../server/fns/settingsHub'

// The package declares IconSvgObject but doesn't export it; infer it from an icon.
type IconSvg = typeof Target01Icon

export const Route = createFileRoute('/_authenticated/settings/')({
  // The status lines are a courtesy: a failed read shows the hub without them rather
  // than taking away the one screen every setting is reached from.
  loader: () => getSettingsStatuses().catch((): SettingsStatuses => ({})),
  component: Settings,
})

type Card = {
  title: string
  description: string
  to: LinkProps['to']
  icon: IconSvg
  /** Only an admin changes it, so the card is hidden from trustees and finance. */
  adminOnly?: boolean
  /** Money: admin and finance only, matching `canSeePayments` and the Finance screen. */
  moneyOnly?: boolean
}

type Group = { title: string; icon: IconSvg; cards: Card[] }

// Groups follow the order the work happens in: what you fund, how you decide, who you
// are, and how data gets in. A group or card icon never repeats another on this page,
// and never borrows a sidebar area's glyph (`AREA_ICON`) for something that is not
// that area.
const GROUPS: Group[] = [
  {
    title: 'What you fund',
    icon: PiggyBankIcon,
    cards: [
      {
        title: 'Annual budget',
        description:
          'Plan what you will give away this financial year, by programme, and what it costs to run the foundation. Finance tracks your balance and cash flow against it.',
        to: '/settings/budget',
        icon: CoinsPoundIcon,
        moneyOnly: true,
      },
      {
        title: 'Programmes',
        description:
          'Set programme objectives, criteria and priorities, the themes you use, and how you measure impact.',
        to: '/programmes',
        icon: Target01Icon,
      },
      {
        title: 'Rounds',
        description:
          'Open and close funding rounds, set their dates, and choose which programmes each round funds and with what budget.',
        to: '/rounds',
        icon: Calendar03Icon,
      },
    ],
  },
  {
    title: 'How you decide',
    icon: JudgeIcon,
    cards: [
      {
        title: 'Giving strategy',
        description:
          'Write your goals and funding priorities in your own words. Every incoming submission is scored against them.',
        to: '/settings/giving-strategy',
        icon: Compass01Icon,
        adminOnly: true,
      },
      {
        title: 'Shortlisting and voting',
        description:
          'Decide whether round budgets are a limit or a target, and whether admins may vote for a trustee.',
        to: '/settings/shortlisting',
        icon: ThumbsUpDownIcon,
        adminOnly: true,
      },
      {
        title: 'Letters',
        description: `Edit your award and decline letters in your organisation's own style, and choose where replies go.`,
        to: '/settings/letters',
        icon: Mail01Icon,
        adminOnly: true,
      },
    ],
  },
  {
    title: 'Your organisation',
    icon: Building02Icon,
    cards: [
      {
        title: 'Team members',
        description:
          'Invite people, choose what each of them can do, and follow up invitations still outstanding.',
        to: '/settings/team',
        icon: UserGroupIcon,
      },
      {
        title: 'Activity',
        description:
          'Review every action anyone has taken (decisions, payments, reporting and access) and export it for your auditor.',
        to: '/settings/activity',
        icon: HistoryIcon,
        adminOnly: true,
      },
    ],
  },
  {
    title: 'Getting data in',
    icon: PlugSocketIcon,
    cards: [
      {
        title: 'API keys',
        description:
          'Create, review and revoke the keys your website or intake form uses to send applications and reports.',
        to: '/settings/api-keys',
        icon: Key01Icon,
        adminOnly: true,
      },
      {
        title: 'Submission guide',
        description:
          'Look up the endpoints, format and fields to send us for applications and reports.',
        to: '/settings/submissions',
        icon: SourceCodeIcon,
        adminOnly: true,
      },
      {
        title: 'Data import',
        description:
          'Bring in the grants you have already made, so payments, reports and totals are right from day one.',
        to: '/settings/data-import',
        icon: DatabaseImportIcon,
        adminOnly: true,
      },
    ],
  },
]

function SettingsCard({ card, status }: { card: Card; status?: TileStatus }) {
  return (
    <Link
      to={card.to}
      className="group flex gap-4 rounded-card border p-4 transition-colors hover:border-brand/40 hover:bg-background"
      style={{ borderColor: C.line }}
    >
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-control"
        style={{ backgroundColor: C.brandWash, color: C.brand }}
      >
        <HugeiconsIcon icon={card.icon} size={20} strokeWidth={1.75} />
      </span>
      {/* A column that fills the tile, so the status line sits on the tile's foot and
          lines up across a row whatever length the descriptions above it run to. */}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className="block font-display text-body font-medium group-hover:underline"
          style={{ color: C.ink }}
        >
          {card.title}
        </span>
        <span
          className="mt-1 block font-display text-label leading-relaxed"
          style={{ color: C.sub }}
        >
          {card.description}
        </span>
        {status && <StatusLine status={status} />}
      </span>
    </Link>
  )
}

/**
 * Grey for a fact, warning with a dot for something missing (the rule is
 * `lib/settingsStatus`). The dot and the words carry it as well as the colour, and the
 * attention case says so to a screen reader too.
 */
function StatusLine({ status }: { status: TileStatus }) {
  return (
    <span
      className={`mt-auto flex min-w-0 items-center gap-1.5 pt-3 font-display text-label font-medium ${
        status.attention ? 'text-warning' : 'text-grey-500'
      }`}
    >
      {status.attention && (
        <>
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warning" />
          <span className="sr-only">Needs attention: </span>
        </>
      )}
      <span className="truncate" title={status.text}>
        {status.text}
      </span>
    </span>
  )
}

function Settings() {
  const { user } = Route.useRouteContext()
  const statuses = Route.useLoaderData()
  const isAdmin = user.role === 'admin' || user.role === 'superadmin'

  // A trustee still needs to see the rounds and programmes their applications sit
  // in, so the hub filters cards rather than hiding itself from non-admins.
  const seesMoney = canSeePayments(user.role)
  const groups = GROUPS.map((g) => ({
    ...g,
    cards: g.cards.filter((c) => (isAdmin || !c.adminOnly) && (seesMoney || !c.moneyOnly)),
  })).filter((g) => g.cards.length > 0)

  return (
    // Full width and the app's own header, like every other top-level screen. The hub
    // is a place you navigate FROM, so it belongs with the list screens rather than with
    // the capped, form-shaped pages it links to.
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-heading font-medium" style={{ color: C.ink }}>
          Settings
        </h1>
        <p className="font-display text-body" style={{ color: C.sub }}>
          {/* Finance can edit the annual budget, so only a trustee is told outright
              that nothing here is theirs to change. */}
          {isAdmin
            ? 'What your foundation funds, how it decides, who is on the team, and how applications and reports reach you.'
            : seesMoney
              ? 'Your annual budget, what your foundation funds, and who is on the team.'
              : 'What your foundation funds and who is on the team. Only an admin can change these.'}
        </p>
      </div>

      {/* Capped so a wide display keeps some air rather than stretching three tiles into
          long thin lines; three columns from medium up, where no group has more than three. */}
      <div className="flex max-w-6xl flex-col gap-6">
        {groups.map((group) => (
          <section key={group.title}>
            <div className="flex items-center gap-2.5">
              <span
                className="flex size-7 items-center justify-center rounded-chip"
                style={{ backgroundColor: C.brandWash, color: C.brand }}
              >
                <HugeiconsIcon icon={group.icon} size={16} strokeWidth={1.75} />
              </span>
              <h2 className="font-display text-title font-medium" style={{ color: C.ink }}>
                {group.title}
              </h2>
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
              {group.cards.map((card) => (
                <SettingsCard key={card.title} card={card} status={statuses[String(card.to)]} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
