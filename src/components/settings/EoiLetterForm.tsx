// ─── Settings › Letters › Expressions of interest ───────────────────────────────
//
// The two letters an EOI can lead to, on one tab: the decline (sent in a batch from the
// EOI list) and the invitation to apply (the starting text of the email sent from an
// EOI). One Save for both, since they are one sitting's work. Signed as the decline
// letter is, so there is no signatory field here; the hint says where it comes from.

import { useState } from 'react'
import { useRemembered } from '../../lib/useRemembered'
import { getEoiLetterSettings, updateEoiLetterSettings } from '../../server/fns/eoiLetters'
import { AwardLetterPreview } from '../AwardLetterPreview'
import { Button, Panel, PanelTitle, Textarea, UnsavedChangesGuard, toast } from '../ui'
import { SettingsSaveBar } from './SettingsSaveBar'
import { C } from '../ui/tokens'
import {
  DEFAULT_EOI_DECLINE_TEMPLATE,
  DEFAULT_EOI_INVITE_TEMPLATE,
  EOI_LETTER_TOKENS,
  renderEoiDecline,
  renderEoiInvite,
  storedTemplate,
} from '../../lib/eoiLetters'

type Settings = Awaited<ReturnType<typeof getEoiLetterSettings>>

const hintClass = 'mt-1.5 font-display text-label text-grey-500'

const SAMPLE = { organisationName: 'Pennine Youth Alliance', programmeName: 'Warm Homes' }

export function EoiLetterForm({ settings }: { settings: Settings }) {
  const [decline, setDecline] = useState(settings?.declineTemplate ?? DEFAULT_EOI_DECLINE_TEMPLATE)
  const [invite, setInvite] = useState(settings?.inviteTemplate ?? DEFAULT_EOI_INVITE_TEMPLATE)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tokensOpen, setTokensOpen] = useRemembered('eoi-letters.tokens', false)

  const payload = {
    declineTemplate: storedTemplate(decline, DEFAULT_EOI_DECLINE_TEMPLATE),
    inviteTemplate: storedTemplate(invite, DEFAULT_EOI_INVITE_TEMPLATE),
  }
  const [baseline, setBaseline] = useState(() => ({
    declineTemplate: storedTemplate(
      settings?.declineTemplate ?? DEFAULT_EOI_DECLINE_TEMPLATE,
      DEFAULT_EOI_DECLINE_TEMPLATE,
    ),
    inviteTemplate: storedTemplate(
      settings?.inviteTemplate ?? DEFAULT_EOI_INVITE_TEMPLATE,
      DEFAULT_EOI_INVITE_TEMPLATE,
    ),
  }))
  const dirty = JSON.stringify(payload) !== JSON.stringify(baseline)

  const sample = {
    ...SAMPLE,
    foundationName: settings?.foundationName || 'Your Foundation',
    signatory: settings?.signatory ?? null,
  }
  const declinePreview = renderEoiDecline(sample, decline)
  const invitePreview = renderEoiInvite(sample, invite)

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      await updateEoiLetterSettings({ data: payload })
      setBaseline(payload)
      toast('Expression of interest letters saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const signedBy = settings?.signatory
    ? `Signed by ${settings.signatory}, as your decline letters are.`
    : 'Signed in the foundation’s name, as your decline letters are. Set a signatory on the Decline letter tab.'

  return (
    <div className="flex flex-col gap-4">
      <LetterPanel
        title="Decline letter"
        intro="Sent to the organisations whose expression of interest you declined, when you send decline letters from the expressions of interest list."
        value={decline}
        standard={DEFAULT_EOI_DECLINE_TEMPLATE}
        onChange={setDecline}
        hint={signedBy}
        preview={declinePreview.bodyText}
        subject={declinePreview.subject}
      />
      <LetterPanel
        title="Invitation to apply"
        intro="The starting text of the email inviting an organisation to make a full application. You can still change it before it is sent, and the link to your application form goes beneath it."
        value={invite}
        standard={DEFAULT_EOI_INVITE_TEMPLATE}
        onChange={setInvite}
        hint={signedBy}
        preview={invitePreview.body}
        subject={invitePreview.subject}
      />

      <details
        open={tokensOpen}
        onToggle={(e) => setTokensOpen(e.currentTarget.open)}
        className="rounded-card border bg-white"
        style={{ borderColor: C.line }}
      >
        <summary
          className="cursor-pointer px-4 py-2.5 font-display text-body font-medium"
          style={{ color: C.ink }}
        >
          What you can put in braces
        </summary>
        <div className="border-t px-4 py-3" style={{ borderColor: C.line }}>
          <dl className="flex flex-col gap-2">
            {EOI_LETTER_TOKENS.map((t) => (
              <div key={t.name} className="flex gap-3 font-display text-label">
                <dt className="w-[170px] shrink-0 font-mono" style={{ color: C.brand }}>
                  {`{{${t.name}}}`}
                </dt>
                <dd style={{ color: C.sub }}>{t.description}</dd>
              </div>
            ))}
          </dl>
        </div>
      </details>

      <SettingsSaveBar onSave={handleSave} saving={saving} dirty={dirty} error={error} />
      <UnsavedChangesGuard dirty={dirty} what="your expression of interest letters" />
    </div>
  )
}

function LetterPanel({
  title,
  intro,
  value,
  standard,
  onChange,
  hint,
  preview,
  subject,
}: {
  title: string
  intro: string
  value: string
  standard: string
  onChange: (next: string) => void
  hint: string
  preview: string
  subject: string
}) {
  const isStandard = storedTemplate(value, standard) === null
  return (
    <Panel label={title}>
      <PanelTitle
        right={
          !isStandard && (
            <Button variant="text" size="xs" onClick={() => onChange(standard)}>
              Reset to Custodian’s standard letter
            </Button>
          )
        }
      >
        {title}
      </PanelTitle>
      <p className="-mt-2 font-display text-body leading-relaxed" style={{ color: C.sub }}>
        {intro}
      </p>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <Textarea
            aria-label={title}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            spellCheck
            className="min-h-[280px] font-mono text-label leading-relaxed"
          />
          <p className={hintClass}>
            {isStandard
              ? 'You are using Custodian’s standard letter.'
              : 'You are using your own letter.'}{' '}
            {hint}
          </p>
        </div>
        <div className="min-w-0 rounded-card border p-4" style={{ borderColor: C.line }}>
          <div
            className="mb-4 border-b pb-3 font-display text-label"
            style={{ borderColor: C.wash, color: C.faint }}
          >
            Subject: <span style={{ color: C.sub }}>{subject}</span>
          </div>
          <AwardLetterPreview bodyText={preview} />
        </div>
      </div>
    </Panel>
  )
}
