import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { getAwardLetterSettings, updateAwardLetterSettings } from '../../server/fns/awardSetup'
import { SettingsPage } from '../../components/SettingsPage'
import { AwardLetterPreview } from '../../components/AwardLetterPreview'
import { Button } from '../../components/ui'
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

const inputClass =
  'w-full rounded-chip border border-gray-200 px-3 py-2 text-body text-gray-700 focus:outline-hidden focus:ring-2 focus:ring-brand/30'

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

  const usingDefaultTemplate = template.trim() === DEFAULT_AWARD_LETTER_TEMPLATE.trim()

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
      await updateAwardLetterSettings({
        data: {
          // Writing null when the editor matches the built-in keeps the foundation on
          // the default rather than freezing today's wording into their row — they
          // then pick up improvements to it instead of drifting silently behind.
          template: usingDefaultTemplate ? null : template,
          conditions,
          signatory: signatory || null,
          senderName: senderName || null,
          replyTo: replyTo || null,
        },
      })
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
      <div className="space-y-8">
        {/* ── How it is sent ── */}
        <section>
          <h2 className="text-body font-semibold text-gray-900">How it is sent</h2>
          <p className="mt-1 text-body leading-relaxed text-gray-500">
            The letter goes out under your foundation’s name, and replies come back to you.
          </p>
          <div className="mt-4 space-y-4">
            <div>
              <label className="block">
                <span className="mb-1.5 block text-body font-medium text-gray-900">
                  Sender name
                </span>
                <input
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder={settings?.foundationName || 'Your foundation'}
                  className={inputClass}
                />
              </label>
              <p className="mt-1 text-label text-gray-500">
                Shown as the sender. The email itself is sent by Custodian’s mail service — mail
                providers check the sending domain against its DNS records, so a letter claiming to
                come from your own domain would be treated as forged and land in spam.
              </p>
            </div>
            <div>
              <label className="block">
                <span className="mb-1.5 block text-body font-medium text-gray-900">
                  Reply-to address
                </span>
                <input
                  type="email"
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                  placeholder="grants@yourfoundation.org"
                  className={inputClass}
                />
              </label>
              <p className="mt-1 text-label text-gray-500">
                Where a grantee’s reply lands. Set this — without it, replies come back to Custodian
                rather than to you.
              </p>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-body font-medium text-gray-900">Signed by</span>
              <input
                value={signatory}
                onChange={(e) => setSignatory(e.target.value)}
                placeholder="Jane Fairfax, Chair of Trustees"
                className={inputClass}
              />
            </label>
          </div>
        </section>

        {/* ── The letter ── */}
        <section>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-body font-semibold text-gray-900">The letter</h2>
            {!usingDefaultTemplate && (
              <button
                onClick={() => setTemplate(DEFAULT_AWARD_LETTER_TEMPLATE)}
                className="text-label font-medium text-gray-500 hover:text-gray-900"
              >
                Reset to Custodian’s standard letter
              </button>
            )}
          </div>
          <p className="mt-1 text-body leading-relaxed text-gray-500">
            Write it as you would write a letter. Anything in double braces is filled in per award.
          </p>
          <textarea
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            spellCheck
            className={`${inputClass} mt-3 min-h-[380px] font-mono text-label leading-relaxed`}
          />
          <p className="mt-1.5 text-label text-gray-500">
            {usingDefaultTemplate
              ? 'You are using Custodian’s standard letter. Edit it to make it yours.'
              : 'You are using your own letter.'}
          </p>

          <details className="mt-4 rounded-chip border border-gray-200 bg-background">
            <summary className="cursor-pointer px-4 py-2.5 text-body font-medium text-gray-900">
              What you can put in braces
            </summary>
            <div className="border-t border-gray-200 px-4 py-3">
              <dl className="space-y-2">
                {AWARD_LETTER_TOKENS.map((t) => (
                  <div key={t.name} className="flex gap-3 text-label">
                    <dt className="w-[170px] shrink-0 font-mono text-brand">
                      {`{{${t.name}}}`}
                    </dt>
                    <dd className="text-gray-500">{t.description}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </details>
        </section>

        {/* ── Conditions ── */}
        <section>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-body font-semibold text-gray-900">Conditions of grant</h2>
            <button
              onClick={() => setConditions(DEFAULT_GRANT_CONDITIONS)}
              className="text-label font-medium text-gray-500 hover:text-gray-900"
            >
              Reset to Custodian’s standard conditions
            </button>
          </div>
          <p className="mt-1 text-body leading-relaxed text-gray-500">
            Attached to every award letter, in this order. You can switch them off for a particular
            batch, and add a condition to a single grant, during award set-up.
          </p>
          <div className="mt-3 space-y-2">
            {conditions.map((c, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="w-4 shrink-0 pt-2 text-label text-gray-400">{i + 1}</span>
                <textarea
                  value={c}
                  onChange={(e) =>
                    setConditions(conditions.map((x, idx) => (idx === i ? e.target.value : x)))
                  }
                  className={`${inputClass} min-h-[62px] resize-y text-body leading-relaxed`}
                />
                <button
                  onClick={() => setConditions(conditions.filter((_, idx) => idx !== i))}
                  className="mt-1.5 shrink-0 rounded-chip p-1 text-gray-300 hover:bg-danger/10 hover:text-danger"
                  aria-label={`Remove condition ${i + 1}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={newCondition}
              onChange={(e) => setNewCondition(e.target.value)}
              placeholder="Add a condition…"
              className={inputClass}
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
            <p className="mt-2 text-label text-warning">
              No standard conditions. Your award letters will carry only whatever you add to an
              individual grant.
            </p>
          )}
        </section>

        {/* ── Preview ── */}
        <section>
          <h2 className="text-body font-semibold text-gray-900">Preview</h2>
          <p className="mt-1 text-body text-gray-500">
            A worked example, with a made-up grant filled in.
          </p>
          <div className="mt-3 rounded-card border border-gray-200 bg-white p-4">
            <div className="mb-4 border-b border-gray-100 pb-3 text-label text-gray-400">
              Subject: <span className="text-gray-500">{preview.subject}</span>
            </div>
            <AwardLetterPreview bodyText={preview.bodyText} />
          </div>
        </section>

        <div className="sticky bottom-0 -mx-1 flex items-center gap-3 border-t border-gray-200 bg-white/95 px-1 py-3 backdrop-blur">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
          </Button>
          {error && <span className="text-label text-danger">{error}</span>}
        </div>
      </div>
    </SettingsPage>
  )
}
