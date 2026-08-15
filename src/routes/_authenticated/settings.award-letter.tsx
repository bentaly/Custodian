import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { getAwardLetterSettings, updateAwardLetterSettings } from '../../server/fns/awardSetup'
import { SettingsPage } from '../../components/SettingsPage'
import { AwardLetterPreview } from '../../components/AwardLetterPreview'
import { Button, ErrorNote, Input, Label, Panel, PanelTitle, Textarea } from '../../components/ui'
import { C } from '../../components/ui/tokens'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import {
  AWARD_LETTER_TOKENS,
  DEFAULT_AWARD_LETTER_TEMPLATE,
  DEFAULT_GRANT_CONDITIONS,
  renderAwardLetter,
} from '../../lib/awardLetter'

export const Route = createFileRoute('/_authenticated/settings/award-letter')({
  beforeLoad: ({ context }) => {
    const isAdmin = context.user.role === 'admin' || context.user.role === 'superadmin'
    if (!isAdmin) throw redirect({ to: '/settings' })
  },
  loader: () => getAwardLetterSettings(),
  component: AwardLetterSettings,
})

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

function AwardLetterSettings() {
  const settings = Route.useLoaderData()

  const [template, setTemplate] = useState(settings?.template ?? DEFAULT_AWARD_LETTER_TEMPLATE)
  const [conditions, setConditions] = useState<string[]>(
    settings?.conditions ?? DEFAULT_GRANT_CONDITIONS,
  )
  const [signatory, setSignatory] = useState(settings?.signatory ?? '')
  const [senderName, setSenderName] = useState(settings?.senderName ?? '')
  const [replyTo, setReplyTo] = useState(settings?.replyTo ?? '')
  const [newCondition, setNewCondition] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

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
    senderName: senderName || null,
    replyTo: replyTo || null,
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
    senderName: settings?.senderName || null,
    replyTo: settings?.replyTo || null,
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
    <SettingsPage
      title="Award letter"
      description="The letter Custodian emails a charity when you award them a grant. We provide a standard letter and a standard set of conditions — change any of it, and every award letter you issue from then on uses your version."
    >
      {/* Each part of the letter is a Panel, as sections are everywhere else — this page
          had bare <h2>s over loose fields, which is the one shape the app doesn't use. */}
      <Panel label="How it is sent">
        <PanelTitle>How it is sent</PanelTitle>
        <p className="-mt-2 mb-4 font-display text-body leading-relaxed" style={{ color: C.sub }}>
          The letter goes out under your foundation’s name, and replies come back to you.
        </p>
        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="letter-sender-name">Sender name</Label>
            <Input
              id="letter-sender-name"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              placeholder={settings?.foundationName || 'Your foundation'}
            />
            <p className={hintClass}>
              Shown as the sender. The email itself is sent by Custodian’s mail service — mail
              providers check the sending domain against its DNS records, so a letter claiming to
              come from your own domain would be treated as forged and land in spam.
            </p>
          </div>
          <div>
            <Label htmlFor="letter-reply-to">Reply-to address</Label>
            <Input
              id="letter-reply-to"
              type="email"
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              placeholder="grants@yourfoundation.org"
            />
            <p className={hintClass}>
              Where a grantee’s reply lands. Set this — without it, replies come back to Custodian
              rather than to you.
            </p>
          </div>
          <div>
            <Label htmlFor="letter-signatory">Signed by</Label>
            <Input
              id="letter-signatory"
              value={signatory}
              onChange={(e) => setSignatory(e.target.value)}
              placeholder="Jane Fairfax, Chair of Trustees"
            />
            <p className={hintClass}>
              The name above the sign-off. Leave it blank to sign in the foundation’s name alone.
            </p>
          </div>
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

        <details className="mt-4 rounded-chip border" style={{ borderColor: C.line }}>
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

      {/* The save bar stays put while you scroll a long letter — the one control on this
          page you always need to reach. */}
      <div
        className="sticky bottom-0 -mx-1 flex items-center gap-3 border-t bg-white/95 px-1 py-3 backdrop-blur"
        style={{ borderColor: C.line }}
      >
        <Button onClick={handleSave} disabled={saving || !dirty}>
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </Button>
        {dirty && !saving && (
          <span className="font-display text-label" style={{ color: C.sub }}>
            Unsaved changes
          </span>
        )}
        <ErrorNote error={error} />
      </div>
    </SettingsPage>
  )
}
