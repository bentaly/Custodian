// ─── Settings › Letters › Award letter ──────────────────────────────────────────
//
// The award-letter half of the Letters screen. A form, not a route: the tabs above it
// own the URL (see `routes/_authenticated/settings.letters.tsx`), and the decline letter
// is its twin next door.
//
// "How it is sent" lives here rather than on the tab pair because it is edited here, but
// it governs BOTH letters — sender name and reply-to are facts about how the foundation
// appears in email, not about one letter, so they are stored once (`award_letter_*`) and
// the decline tab says so rather than asking again.

import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { useRemembered } from '../../lib/useRemembered'
import { getAwardLetterSettings, updateAwardLetterSettings } from '../../server/fns/awardSetup'
import { AwardLetterPreview } from '../AwardLetterPreview'
import { Button, Input, Label, Panel, PanelTitle, Textarea, UnsavedChangesGuard } from '../ui'
import { SettingsSaveBar } from './SettingsSaveBar'
import { C } from '../ui/tokens'
import {
  AWARD_LETTER_TOKENS,
  DEFAULT_AWARD_LETTER_TEMPLATE,
  DEFAULT_GRANT_CONDITIONS,
  renderAwardLetter,
} from '../../lib/awardLetter'

type AwardLetterSettings = Awaited<ReturnType<typeof getAwardLetterSettings>>

/** The hint under a field, in the vocabulary the dialogs use. */
const hintClass = 'mt-1.5 font-display text-label text-grey-500'

/**
 * "Still on Custodian's version". NULL in the row means the built-in, so text that
 * matches it is stored as NULL rather than frozen — and the same test has to answer for
 * a stored value too, or a row saved before that rule reads as an unsaved edit.
 */
const isDefaultTemplate = (t: string | null | undefined) =>
  !t || t.trim() === DEFAULT_AWARD_LETTER_TEMPLATE.trim()

const isDefaultConditions = (c: string[] | null | undefined) =>
  !c ||
  (c.length === DEFAULT_GRANT_CONDITIONS.length &&
    c.every((x, i) => x.trim() === DEFAULT_GRANT_CONDITIONS[i]))

/** A worked example, so the preview shows a real letter rather than token names. */
const SAMPLE = {
  organisationName: 'Pennine Youth Alliance',
  amountAwarded: 38000,
  purpose: 'early intervention youth work with 210 young people in Calderdale',
  startDate: '2026-09-01',
  programmeName: 'Young People & Education',
  roundName: 'Spring 2026',
  reference: 'APP-003',
  instalments: [
    { amount: 19000, dueDate: '2026-09-01' },
    { amount: 19000, dueDate: '2027-03-01' },
  ],
  reporting: [
    { label: 'Interim report', dueDate: '2027-03-01' },
    { label: 'Final report', dueDate: '2027-09-01' },
  ],
}

export function AwardLetterForm({ settings }: { settings: AwardLetterSettings }) {
  const [template, setTemplate] = useState(settings?.template ?? DEFAULT_AWARD_LETTER_TEMPLATE)
  const [conditions, setConditions] = useState<string[]>(
    settings?.conditions ?? DEFAULT_GRANT_CONDITIONS,
  )
  const [signatory, setSignatory] = useState(settings?.signatory ?? '')
  const [newCondition, setNewCondition] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  // Remembered: the token reference is a crib sheet, and someone editing their letter
  // over several sittings should not have to re-open it each time. A native <details>
  // driven from state — `onToggle` fires after the element has already flipped itself,
  // so the stored answer is read off the element rather than inferred.
  const [tokensOpen, setTokensOpen] = useRemembered('award-letter.tokens', false)

  const usingDefaultTemplate = isDefaultTemplate(template)
  const usingDefaultConditions = isDefaultConditions(conditions)

  // Exactly what a save would write. Built once so the Save button's enabled state and
  // the request can never disagree about what counts as a change — a button that reads
  // "unchanged" while the payload differs is worse than no button state at all.
  //
  // Conditions get the same null-when-default treatment as the template: an untouched
  // list must not be frozen into the row, or the foundation stops picking up changes to
  // Custodian's standard conditions without ever having chosen to.
  const payload = {
    template: usingDefaultTemplate ? null : template,
    conditions: usingDefaultConditions ? null : conditions,
    signatory: signatory || null,
  }
  // What is on the server, put through the SAME default-collapsing rule — a row that
  // already stores the built-ins verbatim (saved before that rule existed) is not a
  // change, and would otherwise leave the screen looking dirty before it was touched.
  // Advanced on a successful save rather than re-read, since the loader data behind this
  // screen does not change under us.
  const [baseline, setBaseline] = useState(() => ({
    template: isDefaultTemplate(settings?.template) ? null : (settings?.template ?? null),
    conditions: isDefaultConditions(settings?.conditions) ? null : (settings?.conditions ?? null),
    signatory: settings?.signatory || null,
  }))
  // Both sides are built from the same object literal shape, so key order matches.
  const dirty = JSON.stringify(payload) !== JSON.stringify(baseline)

  const preview = renderAwardLetter({
    input: {
      ...SAMPLE,
      foundationName: settings?.foundationName || 'Your Foundation',
      signatory: signatory || null,
      issuedAt: new Date(),
    },
    settings: { template, conditions, signatory: signatory || null },
  })

  async function handleSave() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      // Writing null where the editor matches the built-in keeps the foundation on the
      // default rather than freezing today's wording into their row — they then pick up
      // improvements to it instead of drifting silently behind.
      await updateAwardLetterSettings({ data: payload })
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
      {/* Each part of the letter is a Panel, as sections are everywhere else — this page
          had bare <h2>s over loose fields, which is the one shape the app doesn't use. */}
      <Panel label="Who signs it">
        <PanelTitle>Who signs it</PanelTitle>
        <div>
          <Label htmlFor="letter-signatory">Signed by</Label>
          <Input
            id="letter-signatory"
            value={signatory}
            onChange={(e) => setSignatory(e.target.value)}
            placeholder="Jane Fairfax, Chair of Trustees"
          />
          <p className={hintClass}>
            The name above the sign-off. Leave it blank to sign in the foundation’s name alone. Your
            decline letters are signed the same way unless you give them a name of their own.
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
                onClick={() => setTemplate(DEFAULT_AWARD_LETTER_TEMPLATE)}
              >
                Reset to Custodian’s standard letter
              </Button>
            )
          }
        >
          The letter
        </PanelTitle>
        <p className="-mt-2 font-display text-body leading-relaxed" style={{ color: C.sub }}>
          Write it as you would write a letter. Anything in double braces is filled in per award.
        </p>
        <Textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          spellCheck
          className="mt-3 min-h-[380px] font-mono text-label leading-relaxed"
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
              {AWARD_LETTER_TOKENS.map((t) => (
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

      <Panel label="Conditions of grant">
        <PanelTitle
          right={
            <Button
              variant="text"
              size="xs"
              onClick={() => setConditions(DEFAULT_GRANT_CONDITIONS)}
            >
              Reset to Custodian’s standard conditions
            </Button>
          }
        >
          Conditions of grant
        </PanelTitle>
        <p className="-mt-2 font-display text-body leading-relaxed" style={{ color: C.sub }}>
          Attached to every award letter, in this order. You can switch them off for a particular
          batch, and add a condition to a single grant, during award set-up.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {conditions.map((c, i) => (
            <div key={i} className="flex items-start gap-2">
              <span
                className="w-4 shrink-0 pt-2 font-display text-label tabular-nums"
                style={{ color: C.faint }}
              >
                {i + 1}
              </span>
              <Textarea
                value={c}
                onChange={(e) =>
                  setConditions(conditions.map((x, idx) => (idx === i ? e.target.value : x)))
                }
                className="min-h-[62px] resize-y leading-relaxed"
              />
              <Button
                variant="ghost"
                size="sm"
                className="mt-1"
                onClick={() => setConditions(conditions.filter((_, idx) => idx !== i))}
                aria-label={`Remove condition ${i + 1}`}
              >
                <HugeiconsIcon icon={Cancel01Icon} size={16} color="currentColor" />
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Input
            value={newCondition}
            onChange={(e) => setNewCondition(e.target.value)}
            placeholder="Add a condition…"
          />
          <Button
            variant="secondary"
            onClick={() => {
              if (!newCondition.trim()) return
              setConditions([...conditions, newCondition.trim()])
              setNewCondition('')
            }}
          >
            Add
          </Button>
        </div>
        {conditions.length === 0 && (
          <p className="mt-2 font-display text-label" style={{ color: C.warning }}>
            No standard conditions. Your award letters will carry only whatever you add to an
            individual grant.
          </p>
        )}
      </Panel>

      <Panel label="Preview">
        <PanelTitle>Preview</PanelTitle>
        <p className="-mt-2 mb-3 font-display text-body" style={{ color: C.sub }}>
          A worked example, with a made-up grant filled in.
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
      <UnsavedChangesGuard dirty={dirty} what="your award letter template" />
    </div>
  )
}
