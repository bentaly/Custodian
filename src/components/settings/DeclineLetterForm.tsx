// ─── Settings › Letters › Decline letter ────────────────────────────────────────
//
// The award letter's twin, and deliberately the same screen minus the two things a
// decline has no use for: there are no conditions of grant (there is no grant), and
// there is no "how it is sent" panel — sender name and reply-to are shared with the
// award letter and edited once, on that tab. Asking for them twice is how a foundation
// ends up with award letters that reply to them and decline letters that do not.

import { useState } from 'react'
import { useRemembered } from '../../lib/useRemembered'
import {
  getDeclineLetterSettings,
  updateDeclineLetterSettings,
} from '../../server/fns/declineLetters'
import { AwardLetterPreview } from '../AwardLetterPreview'
import { Button, Input, Label, Panel, PanelTitle, Textarea } from '../ui'
import { SettingsSaveBar } from './SettingsSaveBar'
import { C } from '../ui/tokens'
import {
  DECLINE_LETTER_TOKENS,
  DEFAULT_DECLINE_LETTER_TEMPLATE,
  renderDeclineLetter,
} from '../../lib/declineLetter'

type DeclineLetterSettings = Awaited<ReturnType<typeof getDeclineLetterSettings>>

const hintClass = 'mt-1.5 font-display text-label text-grey-500'

/** Same rule as the award letter: text matching the built-in is stored as NULL. */
const isDefaultTemplate = (t: string | null | undefined) =>
  !t || t.trim() === DEFAULT_DECLINE_LETTER_TEMPLATE.trim()

/** A worked example, so the preview reads as a letter rather than a list of tokens. */
const SAMPLE = {
  organisationName: 'Pennine Youth Alliance',
  programmeName: 'Young People & Education',
  roundName: 'Spring 2026',
  reference: 'APP-003',
  amountRequested: 38000,
}

export function DeclineLetterForm({ settings }: { settings: DeclineLetterSettings }) {
  const [template, setTemplate] = useState(settings?.template ?? DEFAULT_DECLINE_LETTER_TEMPLATE)
  const [signatory, setSignatory] = useState(settings?.signatory ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [tokensOpen, setTokensOpen] = useRemembered('decline-letter.tokens', false)

  const usingDefaultTemplate = isDefaultTemplate(template)

  // Exactly what a save would write, so the Save button's enabled state and the request
  // can never disagree about what counts as a change.
  const payload = {
    template: usingDefaultTemplate ? null : template,
    signatory: signatory || null,
  }
  const [baseline, setBaseline] = useState(() => ({
    template: isDefaultTemplate(settings?.template) ? null : (settings?.template ?? null),
    signatory: settings?.signatory || null,
  }))
  const dirty = JSON.stringify(payload) !== JSON.stringify(baseline)

  // The signatory shown in the preview is the one that would actually be used: this
  // letter's own, or the award letter's where this one is blank. A preview that signed
  // off blank while the sent letter signed off "Jane Fairfax" would be the one thing a
  // preview must never be — a different document from the one that goes out.
  const preview = renderDeclineLetter({
    input: {
      ...SAMPLE,
      foundationName: settings?.foundationName || 'Your Foundation',
      signatory: signatory || null,
      issuedAt: new Date(),
    },
    settings: { template, signatory: signatory || null },
    awardSignatory: settings?.awardSignatory ?? null,
  })

  async function handleSave() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await updateDeclineLetterSettings({ data: payload })
      setBaseline(payload)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel label="Who signs it">
        <PanelTitle>Who signs it</PanelTitle>
        <div>
          <Label htmlFor="decline-signatory">Signed by</Label>
          <Input
            id="decline-signatory"
            value={signatory}
            onChange={(e) => setSignatory(e.target.value)}
            placeholder={settings?.awardSignatory || 'Jane Fairfax, Chair of Trustees'}
          />
          <p className={hintClass}>
            {settings?.awardSignatory
              ? `Leave it blank to sign these letters the way your award letters are signed — ${settings.awardSignatory}.`
              : 'The name above the sign-off. Leave it blank to sign in the foundation’s name alone.'}
          </p>
        </div>
      </Panel>

      <Panel label="The letter">
        <PanelTitle
          right={
            !usingDefaultTemplate && (
              <Button
                variant="text"
                size="xs"
                onClick={() => setTemplate(DEFAULT_DECLINE_LETTER_TEMPLATE)}
              >
                Reset to Custodian’s standard letter
              </Button>
            )
          }
        >
          The letter
        </PanelTitle>
        <p className="-mt-2 font-display text-body leading-relaxed" style={{ color: C.sub }}>
          Sent to every unsuccessful applicant in a round, when you send decline letters from the
          Applications screen. Anything in double braces is filled in per applicant.
        </p>
        <Textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          spellCheck
          className="mt-3 min-h-[320px] font-mono text-label leading-relaxed"
        />
        <p className={hintClass}>
          {usingDefaultTemplate
            ? 'You are using Custodian’s standard letter. Edit it to make it yours.'
            : 'You are using your own letter.'}
        </p>

        <details
          open={tokensOpen}
          onToggle={(e) => setTokensOpen(e.currentTarget.open)}
          className="mt-4 rounded-chip border"
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
              {DECLINE_LETTER_TOKENS.map((t) => (
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
      </Panel>

      <Panel label="Preview">
        <PanelTitle>Preview</PanelTitle>
        <p className="-mt-2 mb-3 font-display text-body" style={{ color: C.sub }}>
          A worked example, with a made-up application filled in.
        </p>
        <div className="rounded-card border p-4" style={{ borderColor: C.line }}>
          <div
            className="mb-4 border-b pb-3 font-display text-label"
            style={{ borderColor: C.wash, color: C.faint }}
          >
            Subject: <span style={{ color: C.sub }}>{preview.subject}</span>
          </div>
          <AwardLetterPreview bodyText={preview.bodyText} />
        </div>
      </Panel>

      <SettingsSaveBar
        onSave={handleSave}
        saving={saving}
        saved={saved}
        dirty={dirty}
        error={error}
      />
    </div>
  )
}
