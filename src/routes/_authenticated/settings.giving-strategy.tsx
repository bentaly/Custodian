import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getClientProfile, upsertClientProfile } from '../../server/fns/clients'
import { Button, ErrorNote, Panel } from '../../components/ui'
import { RichTextEditor } from '../../components/RichTextEditor'
import { SettingsPage } from '../../components/SettingsPage'

export const Route = createFileRoute('/_authenticated/settings/giving-strategy')({
  beforeLoad: ({ context }) => {
    const isAdmin = context.user.role === 'admin' || context.user.role === 'superadmin'
    if (!isAdmin) throw redirect({ to: '/settings' })
  },
  loader: async () => ({ profile: await getClientProfile() }),
  component: GivingStrategy,
})

function GivingStrategy() {
  const { profile } = Route.useLoaderData()
  const initial = profile?.missionStatement ?? ''
  const [markdown, setMarkdown] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await upsertClientProfile({ data: { missionStatement: markdown } })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setError('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsPage
      title="Giving strategy"
      description="Describe your organisation's goals and funding priorities. Every incoming application is scored against what you write here, so be specific about what you will and won't fund."
    >
      {/* The shared `RichTextEditor`, with headings — this page used to inline its own
          copy of that component with a heading row bolted on, and the two had drifted. */}
      <Panel label="Giving strategy">
        <RichTextEditor defaultValue={initial} onChange={setMarkdown} minHeight="240px" headings />
        <ErrorNote error={error} className="mt-3" />
        <Button onClick={handleSave} disabled={saving || markdown === initial} className="mt-3">
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </Button>
      </Panel>
    </SettingsPage>
  )
}
