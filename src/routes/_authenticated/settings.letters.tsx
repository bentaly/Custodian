// ─── Settings › Letters ─────────────────────────────────────────────────────────
//
// The two letters Custodian sends on a foundation's behalf, on one screen: the award
// letter and the decline letter. It was "Award letter" until there was a second one.
//
// Tabs, not two Settings cards, because the pair is one decision — a foundation writing
// its award letter is the same person, in the same sitting, deciding how it says no —
// and because the sending identity (sender name, reply-to) is shared between them and
// belongs on the screen that owns both. The tabs are NAVIGATION, and the tab lives in
// the URL so a link can land on the one being talked about (the decline dialog links
// straight here).

import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { getAwardLetterSettings } from '../../server/fns/awardSetup'
import { getDeclineLetterSettings } from '../../server/fns/declineLetters'
import { SettingsPage } from '../../components/SettingsPage'
import { AwardLetterForm } from '../../components/settings/AwardLetterForm'
import { LetterSendingForm } from '../../components/settings/LetterSendingForm'
import { DeclineLetterForm } from '../../components/settings/DeclineLetterForm'
import { Tabs } from '../../components/ui'

const LettersSearch = z.object({ tab: z.enum(['award', 'decline']).optional() })

export const Route = createFileRoute('/_authenticated/settings/letters')({
  validateSearch: LettersSearch,
  beforeLoad: ({ context }) => {
    const isAdmin = context.user.role === 'admin' || context.user.role === 'superadmin'
    if (!isAdmin) throw redirect({ to: '/settings' })
  },
  // Both halves in one round trip. The award letter's settings are needed on the
  // decline tab too (its signatory is the decline letter's fallback, and the sending
  // identity is shared), so fetching per tab would only mean fetching most of it twice.
  loader: async () => {
    const [award, decline] = await Promise.all([
      getAwardLetterSettings(),
      getDeclineLetterSettings(),
    ])
    return { award, decline }
  },
  component: Letters,
})

function Letters() {
  const { award, decline } = Route.useLoaderData()
  const { tab = 'award' } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <SettingsPage
      title="Letters"
      description="What Custodian emails an applicant when you make a decision — the award letter that goes with a grant, and the letter that goes to everybody else."
    >
      {/* Above the tabs, because it governs both letters. Everything below the tabs is
          one letter's own. */}
      <LetterSendingForm
        foundationName={award?.foundationName ?? ''}
        senderName={award?.senderName ?? null}
        replyTo={award?.replyTo ?? null}
      />

      <Tabs
        ariaLabel="Letter"
        items={[
          { id: 'award' as const, label: 'Award letter' },
          { id: 'decline' as const, label: 'Decline letter' },
        ]}
        value={tab}
        // `replace`, so paging between the two tabs doesn't fill the back button with
        // steps that look identical from outside the screen.
        onChange={(next) => navigate({ search: { tab: next }, replace: true })}
      />

      {tab === 'award' ? (
        <AwardLetterForm settings={award} />
      ) : (
        <DeclineLetterForm settings={decline} />
      )}
    </SettingsPage>
  )
}
