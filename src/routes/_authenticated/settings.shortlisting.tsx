import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Link } from '@tanstack/react-router'
import { getClientProfile, upsertClientProfile } from '../../server/fns/clients'
import { listClientUsers } from '../../server/fns/users'
import { ErrorNote, Panel, PanelTitle, Toggle } from '../../components/ui'
import { SettingsPage } from '../../components/SettingsPage'
import { C } from '../../components/ui/tokens'
import { fmtList } from '../../lib/format'
import { holdsAVote, majorityOf } from '../../lib/voting'

export const Route = createFileRoute('/_authenticated/settings/shortlisting')({
  beforeLoad: ({ context }) => {
    const isAdmin = context.user.role === 'admin' || context.user.role === 'superadmin'
    if (!isAdmin) throw redirect({ to: '/settings' })
  },
  // The roster comes from the same list the Team screen renders, filtered by the same
  // `holdsAVote`, so the two screens cannot disagree about who is on the board. This page
  // states it; Team is where it is changed.
  loader: async () => ({ profile: await getClientProfile(), members: await listClientUsers() }),
  component: Shortlisting,
})

type SwitchField = 'enforceRoundBudget' | 'allowAdminVoting'

/**
 * The rules an application passes on its way from shortlist to award. They were two
 * pages holding one switch each; both gate the same step, both take effect on the
 * Shortlist and application screens, and a page per switch made the Settings hub read
 * as a list of toggles rather than a map of the foundation. Each saves on the spot, so
 * there is nothing to guard.
 */
function Shortlisting() {
  const { profile, members } = Route.useLoaderData()

  return (
    <SettingsPage
      title="Shortlisting and voting"
      description="The rules an application passes on its way from the shortlist to an award."
    >
      <Panel label="Round budgets">
        <PanelTitle>Round budgets</PanelTitle>
        <p className="mb-4 font-display text-body leading-relaxed text-grey-500">
          Each programme in a round carries a budget. This is what that figure does when you
          shortlist against it.
        </p>
        {/* Both halves are stated, because the setting has no neutral position: off is
            a policy too, and a switch described only by what turning it on does leaves
            a foundation guessing what it is choosing by leaving it alone. */}
        <SettingSwitch
          field="enforceRoundBudget"
          initial={profile?.enforceRoundBudget ?? false}
          title="Stop shortlisting once a programme’s budget is committed"
          explainer="When enabled, an application that would take a programme past its budget for the round cannot be shortlisted, and the button reads “Budget full”. When off, the budget is a target rather than a limit: you can shortlist beyond it, and the shortlist’s proposed spend says how far over the round has gone."
        />
      </Panel>

      <Panel label="Voting">
        <PanelTitle>Voting</PanelTitle>
        <p className="mb-4 font-display text-body leading-relaxed text-grey-500">
          Trustees vote yes or no on shortlisted applications, and a majority is needed before a
          grant can be awarded.
        </p>
        {/* Who that majority is OF. The page said a majority was needed without ever
            saying a majority of whom, which is the question somebody opens it with. It
            is a statement, not a control: the board is changed on Team, beside the roles
            it belongs with, and two places to edit one roster is two rosters. */}
        <VotingBoard members={members} />
        <SettingSwitch
          field="allowAdminVoting"
          initial={profile?.allowAdminVoting ?? false}
          title="Allow admins to record votes on behalf of trustees"
          explainer="When enabled, admins can record yes/no votes for any trustee on an application, which is useful when a trustee sends their decision outside the platform. It is separate from holding a vote of their own."
        />
      </Panel>
    </SettingsPage>
  )
}

/**
 * The voting board, in a sentence, with the number a grant actually needs.
 *
 * Both halves are printed because a count alone is not checkable: "4 people hold a vote"
 * is something a foundation has to take on trust, while the names are something they can
 * read and correct. The threshold is `majorityOf`, the same function the Shortlist card
 * counts down from, so the two screens can never state different arithmetic.
 */
function VotingBoard({
  members,
}: {
  members: Array<{ id: string; name: string; role: string; votesOnApplications: boolean }>
}) {
  const voters = members.filter(holdsAVote)
  const needed = majorityOf(voters.length)

  return (
    <div
      className="mb-4 rounded-card border p-4"
      style={{ borderColor: C.line, backgroundColor: C.wash }}
    >
      {voters.length === 0 ? (
        <p className="font-display text-body leading-relaxed" style={{ color: C.ink }}>
          Nobody holds a vote yet, so no application can be approved. Trustees vote as soon as they
          join.
        </p>
      ) : (
        <p className="font-display text-body leading-relaxed" style={{ color: C.ink }}>
          {voters.length === 1 ? '1 person holds' : `${voters.length} people hold`} a vote:{' '}
          {fmtList(voters.map((v) => v.name))}.{' '}
          {voters.length === 1
            ? 'Their approval carries an application on its own.'
            : `A grant needs ${needed} of them to approve it.`}
        </p>
      )}
      <p className="mt-2 font-display text-label leading-relaxed" style={{ color: C.sub }}>
        Every trustee votes. An admin votes only if they have been given a vote, and a finance user
        never does.{' '}
        <Link
          to="/settings/team"
          className="font-medium hover:underline"
          style={{ color: C.brand }}
        >
          Manage who votes on Team
        </Link>
        .
      </p>
    </div>
  )
}

function SettingSwitch({
  field,
  initial,
  title,
  explainer,
}: {
  field: SwitchField
  initial: boolean
  title: string
  explainer: string
}) {
  const [enabled, setEnabled] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // The setting's own copy, announced with the switch rather than left beside it.
  const copyId = `${field}-explainer`

  async function handleToggle(next: boolean) {
    setEnabled(next)
    setSaving(true)
    setError('')
    try {
      await upsertClientProfile({ data: { [field]: next } })
    } catch {
      setEnabled(!next) // revert on failure
      setError('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="font-display text-body font-medium text-grey-900">{title}</p>
        <p id={copyId} className="mt-0.5 font-display text-body leading-relaxed text-grey-500">
          {explainer}
        </p>
        <ErrorNote error={error} className="mt-2" />
      </div>
      <Toggle
        checked={enabled}
        onChange={handleToggle}
        busy={saving}
        label={title}
        describedBy={copyId}
      />
    </div>
  )
}
