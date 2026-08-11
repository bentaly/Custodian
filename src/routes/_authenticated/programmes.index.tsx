import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import {
  Add01Icon,
  ArchiveRestoreIcon,
  Delete02Icon,
  PencilEdit02Icon,
} from '@hugeicons/core-free-icons'
import { listProgrammes, listClientTags, setProgrammeArchived } from '../../server/fns/programmes'
import {
  ProgrammeDialog,
  emptyProgrammeDraft,
  type ProgrammeDraft,
} from '../../components/ProgrammeDialog'
import { getRoundStatus } from '../../lib/roundStatus'
import { impactUnitLabel, DEFAULT_IMPACT_UNIT } from '../../lib/impactUnits'
import { ActionMenu, Badge, Breadcrumb, Button, Card, EmptyState } from '../../components/ui'
import { colourName, resolveProgrammeColour } from '../../lib/programmeColours'

export const Route = createFileRoute('/_authenticated/programmes/')({
  loader: async () => {
    // Archived programmes are shown here (dimmed) and nowhere else — see the round
    // list for why.
    const [programmes, clientTags] = await Promise.all([
      listProgrammes({ data: { includeArchived: true } }),
      listClientTags(),
    ])
    return { programmes, clientTags }
  },
  component: Programmes,
})

type ProgrammeRow = Awaited<ReturnType<typeof listProgrammes>>[number]

function roundBadge(roundProgrammes: ProgrammeRow['roundProgrammes']) {
  if (roundProgrammes.some((rp) => getRoundStatus(rp.round) === 'open'))
    return { label: 'In open round', color: 'bg-success/10 text-success' }
  if (roundProgrammes.length > 0)
    return {
      label: `${roundProgrammes.length} round${roundProgrammes.length > 1 ? 's' : ''}`,
      color: 'bg-gray-100 text-gray-500',
    }
  return { label: 'No round', color: 'bg-warning/10 text-warning' }
}

/**
 * The one-line summary under a programme's name. The dialog no longer collects a
 * separate description — it collects objectives — so this is the first line of that,
 * with markdown stripped. A legacy `description` still wins where one exists, so
 * nothing a foundation typed before goes invisible.
 */
function summarise(programme: ProgrammeRow): string | null {
  if (programme.description?.trim()) return programme.description.trim()
  const plain = (programme.goal ?? '')
    .replace(/[#*_~`[\]]/g, '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  return plain ?? null
}

function Programmes() {
  const router = useRouter()
  const { user } = Route.useRouteContext()
  const { programmes, clientTags } = Route.useLoaderData()
  const canManage = ['superadmin', 'admin'].includes(user.role)

  const [draft, setDraft] = useState<ProgrammeDraft | undefined>()

  // Every programme's colour as displayed — stored where there is one, positional for
  // rows that predate the column. Both feed "already in use", so the picker never offers
  // a colour as free when a swatch on the screen behind it is already that colour.
  const colours = programmes.map((p, i) => resolveProgrammeColour(p.colour, i))

  /** hex → the name of the OTHER programme using it. Excludes the one being edited, so
   *  a programme never reports its own colour as taken. */
  function takenColoursExcluding(id?: string): Record<string, string> {
    const taken: Record<string, string> = {}
    programmes.forEach((p, i) => {
      if (p.id === id) return
      taken[colours[i]!] ??= p.name
    })
    return taken
  }

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb items={[{ label: 'Settings', to: '/settings' }, { label: 'Programmes' }]} />

      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-heading font-medium text-gray-900">Programmes</h1>
          <p className="font-display text-label text-gray-500">
            The themes you fund. Set the themes used to match applications, and the unit each
            programme measures its impact in.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setDraft(emptyProgrammeDraft(colours))} icon={Add01Icon}>
            New programme
          </Button>
        )}
      </div>

      {programmes.length === 0 ? (
        <EmptyState>
          <p className="font-display text-body text-gray-500">No programmes yet.</p>
          {canManage && (
            <p className="mt-1 font-display text-body text-gray-400">
              Create your first programme to get started.
            </p>
          )}
        </EmptyState>
      ) : (
        programmes.map((programme, i) => (
          <ProgrammeCard
            key={programme.id}
            programme={programme}
            colour={colours[i]!}
            canManage={canManage}
            onEdit={() =>
              setDraft({
                id: programme.id,
                name: programme.name,
                goal: programme.goal ?? '',
                tags: (programme.tags ?? []) as string[],
                impactUnit: programme.impactUnit ?? DEFAULT_IMPACT_UNIT,
                impactUnitLabel: programme.impactUnitLabel ?? '',
                colour: colours[i]!,
              })
            }
          />
        ))
      )}

      <ProgrammeDialog
        open={draft !== undefined}
        draft={draft}
        suggestions={clientTags}
        takenColours={takenColoursExcluding(draft?.id)}
        onClose={() => setDraft(undefined)}
        onSaved={() => {
          setDraft(undefined)
          router.invalidate()
        }}
      />
    </div>
  )
}

function ProgrammeCard({
  programme,
  colour,
  canManage,
  onEdit,
}: {
  programme: ProgrammeRow
  colour: string
  canManage: boolean
  onEdit: () => void
}) {
  const router = useRouter()
  const [archiving, setArchiving] = useState(false)
  const tags = (programme.tags ?? []) as string[]
  const badge = roundBadge(programme.roundProgrammes)
  const summary = summarise(programme)

  async function toggleArchived() {
    setArchiving(true)
    try {
      await setProgrammeArchived({ data: { id: programme.id, archived: !programme.archivedAt } })
      router.invalidate()
    } finally {
      setArchiving(false)
    }
  }

  const archived = programme.archivedAt !== null

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* `aria-hidden`: the colour is a visual shorthand for the name beside it,
                so announcing it would only add noise. The `title` is for the sighted
                reader wondering which of two similar swatches they are looking at. */}
            <span
              aria-hidden="true"
              title={colourName(colour) ?? undefined}
              className={`size-3 shrink-0 rounded-swatch ${archived ? 'opacity-40' : ''}`}
              style={{ backgroundColor: colour }}
            />
            <h2
              className={`font-display text-title font-semibold ${archived ? 'text-gray-400' : 'text-gray-900'}`}
            >
              {programme.name}
            </h2>
            {/* An archived programme is in no round by definition of being retired, so
                the round badge would only ever say "No round" in warning orange —
                alarming about a state that was chosen deliberately. */}
            {archived ? (
              <Badge className="bg-gray-100 text-gray-500">Archived</Badge>
            ) : (
              <Badge className={badge.color}>{badge.label}</Badge>
            )}
          </div>
          {summary && (
            <p
              className={`line-clamp-2 font-display text-body ${archived ? 'text-gray-400' : 'text-gray-600'}`}
            >
              {summary}
            </p>
          )}
        </div>

        {canManage && (
          <ActionMenu
            label={`Actions for ${programme.name}`}
            actions={[
              { label: 'Edit', icon: PencilEdit02Icon, onSelect: onEdit },
              // Archive, never delete — same rule as rounds. A programme with grants
              // against it is referenced by the round budgets those grants were judged
              // against, so retiring it has to be reversible.
              archived
                ? {
                    label: 'Restore',
                    icon: ArchiveRestoreIcon,
                    onSelect: toggleArchived,
                    disabled: archiving,
                  }
                : {
                    label: 'Archive',
                    icon: Delete02Icon,
                    destructive: true,
                    onSelect: toggleArchived,
                    disabled: archiving,
                  },
            ]}
          />
        )}
      </div>

      {/* Collapsed once archived: the themes and impact unit describe how a programme
          takes applications, and a retired one takes none. The name and summary stay,
          because finding it again is the only reason to look at this row. */}
      {!archived && (
        <div className="flex flex-col gap-4 sm:flex-row sm:gap-16">
          <Stat label="Impact measured in">
            {impactUnitLabel(programme.impactUnit, programme.impactUnitLabel)}
          </Stat>
          <Stat label="Themes">
            {tags.length > 0 ? tags.join(', ') : <span className="text-gray-400">—</span>}
          </Stat>
        </div>
      )}
    </Card>
  )
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-[120px] flex-col gap-2">
      <span className="font-display text-label font-medium text-gray-500">{label}</span>
      <span className="font-display text-body font-medium text-gray-700">{children}</span>
    </div>
  )
}
