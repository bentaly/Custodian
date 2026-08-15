import { createFileRoute, Link, type LinkProps } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Building02Icon,
  Calendar03Icon,
  DatabaseImportIcon,
  Idea01Icon,
  Key01Icon,
  Mail01Icon,
  PlugSocketIcon,
  SourceCodeIcon,
  Target01Icon,
  ThumbsUpDownIcon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import { C } from '../../components/ui/tokens'

// The package declares IconSvgObject but doesn't export it; infer it from an icon.
type IconSvg = typeof Target01Icon

export const Route = createFileRoute('/_authenticated/settings/')({
  component: Settings,
})

// Same palette the dashboard pins down, so the whole app re-themes from one place
// when the full Figma token set lands.

type Card = {
  title: string
  description: string
  to: LinkProps['to']
  icon: IconSvg
  /** Config the whole foundation shares — trustees and finance may look, not touch. */
  adminOnly?: boolean
}

type Group = { title: string; icon: IconSvg; cards: Card[] }

const GROUPS: Group[] = [
  {
    title: 'Funding setup',
    icon: Target01Icon,
    cards: [
      {
        title: 'Rounds',
        description:
          'Open and close funding rounds, set their dates, and choose which programmes each round funds and with what budget.',
        to: '/rounds',
        icon: Calendar03Icon,
      },
      {
        title: 'Programmes',
        description:
          'The themes you fund. Set the tags used to match applications, and the unit each programme measures its impact in.',
        to: '/programmes',
        icon: Target01Icon,
      },
      {
        title: 'Giving strategy',
        description:
          'Your goals and funding priorities, in your own words. This is what incoming applications are scored against.',
        to: '/settings/giving-strategy',
        icon: Idea01Icon,
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
          'Who has access, what each role can do, and the invitations you have sent that are still outstanding.',
        to: '/settings/team',
        icon: UserGroupIcon,
      },
      {
        title: 'Voting',
        description:
          'How trustees record decisions on applications, and whether admins may vote on a trustee’s behalf.',
        to: '/settings/voting',
        icon: ThumbsUpDownIcon,
        adminOnly: true,
      },
      {
        title: 'Award letter',
        description:
          'The letter emailed to a charity when you award a grant, your standard conditions of grant, and who replies come back to.',
        to: '/settings/award-letter',
        icon: Mail01Icon,
        adminOnly: true,
      },
    ],
  },
  {
    title: 'Receiving applications',
    icon: PlugSocketIcon,
    cards: [
      {
        title: 'API keys',
        description:
          'The keys that let your website or intake form post applications and reports to Custodian. Create, review and revoke them here.',
        to: '/settings/api-keys',
        icon: Key01Icon,
        adminOnly: true,
      },
      {
        title: 'Submitting applications',
        description:
          'What to send us and what each field means — the endpoints, the format, and the full list of fields we recognise.',
        to: '/settings/submissions',
        icon: SourceCodeIcon,
        adminOnly: true,
      },
      {
        title: 'Data import',
        description:
          'Bring the grants you have already made into Custodian, so your payments, reports and totals are right from day one.',
        to: '/settings/data-import',
        icon: DatabaseImportIcon,
        adminOnly: true,
      },
    ],
  },
]

function SettingsCard({ card }: { card: Card }) {
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
      <span className="min-w-0">
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
      </span>
    </Link>
  )
}

function Settings() {
  const { user } = Route.useRouteContext()
  const isAdmin = user.role === 'admin' || user.role === 'superadmin'

  // A trustee still needs to see the rounds and programmes their applications sit
  // in, so the hub filters cards rather than hiding itself from non-admins.
  const groups = GROUPS.map((g) => ({
    ...g,
    cards: g.cards.filter((c) => isAdmin || !c.adminOnly),
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
          {isAdmin
            ? 'Manage how your foundation funds, decides and receives applications.'
            : 'How your foundation funds and decides. Ask an admin to change any of it.'}
        </p>
      </div>

      <div className="flex flex-col gap-6">
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
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.cards.map((card) => (
                <SettingsCard key={card.title} card={card} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
