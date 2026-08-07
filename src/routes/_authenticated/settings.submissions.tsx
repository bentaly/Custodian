import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Card, Tabs, type TabItem } from '../../components/ui'
import { SettingsPage } from '../../components/SettingsPage'
import {
  CANONICAL_FIELDS,
  REQUIRED_ONE_OF_GROUPS,
  EXPECTED_ONE_OF_GROUPS,
  describeOneOfGroup,
  type FieldTier,
} from '../../lib/fieldMapping/canonical'
import { REPORT_CANONICAL_FIELDS } from '../../lib/fieldMapping/reportCanonical'

export const Route = createFileRoute('/_authenticated/settings/submissions')({
  beforeLoad: ({ context }) => {
    const isAdmin = context.user.role === 'admin' || context.user.role === 'superadmin'
    if (!isAdmin) throw redirect({ to: '/settings' })
  },
  component: Submissions,
})

// Both registries share a shape, so one table renders either. Reading them straight
// from the mapper's source of truth means this page cannot drift out of date — which
// matters more now that this page IS the spec a foundation builds their form against.
//
// The report registry is still two-tier (`required: boolean`), so it is normalised into
// the same three-tier shape for display rather than each registry growing its own table.
type Field = {
  key: string
  label: string
  tier: FieldTier
  description: string
  /** What stops working without it — shown to a foundation deciding whether to send it. */
  degrades?: string
}

type Kind = 'applications' | 'reports'

const TIER_BADGE: Record<FieldTier, { label: string; className: string } | null> = {
  required: {
    label: 'Required',
    className: 'bg-[#FEF0E6] text-[#B45309]',
  },
  one_of: {
    label: 'One of a pair',
    className: 'bg-[#FEF7EB] text-[#9B6916]',
  },
  // No badge: an `expected` field is genuinely optional to send. Its cost is spelled
  // out in the description instead, where it reads as guidance rather than a demand.
  expected: null,
}

const TABS: TabItem<Kind>[] = [
  { id: 'applications', label: 'Applications' },
  { id: 'reports', label: 'Reports' },
]

const ENDPOINTS = {
  applications: {
    path: '/api/apply',
    blurb:
      'Post a completed application. Every field you send is matched to one of the fields below, including your own application reference.',
    fields: CANONICAL_FIELDS as Field[],
  },
  reports: {
    path: '/api/submit-report',
    blurb:
      'Post a grant report. Reports link to a grant automatically when your application reference matches one we already hold; anything else waits in the Reports queue for an admin.',
    fields: REPORT_CANONICAL_FIELDS.map(
      (f): Field => ({
        key: f.key,
        label: f.label,
        tier: f.required ? 'required' : 'expected',
        description: f.description,
      }),
    ),
  },
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-sm bg-gray-100 px-1.5 py-0.5 font-mono text-[12px] text-[#141C24]">
      {children}
    </code>
  )
}

function Submissions() {
  const [tab, setTab] = useState<Kind>('applications')
  const active = ENDPOINTS[tab]

  const example = [
    `curl -X POST https://custodian.bental.workers.dev${active.path} \\`,
    `  -H "Authorization: Bearer cust_sk_your_key_here" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{ "Your field name": "value", "Another field": "value" }'`,
  ].join('\n')

  return (
    <SettingsPage
      title="Submitting applications"
      description="How your website or intake form sends applications and reports to Custodian, and what each field should contain."
    >
      <div className="space-y-8">
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-gray-700">How it works</h2>
          <Card className="space-y-3 p-5 text-sm leading-relaxed text-[#475467]">
            <p>
              Send us a flat object of your own field names and their values — there are no reserved
              keys and no wrapper to build. We match each of your field names to one of the fields
              below, so you can keep calling things whatever your form already calls them.
            </p>
            <p>
              Authenticate with an API key in the <Code>Authorization: Bearer …</Code> header. JSON
              and form-encoded bodies are both accepted. We reply <Code>202 Accepted</Code> straight
              away and do the matching afterwards; anything we can't place with confidence waits in
              a queue rather than being guessed at.
            </p>
            <p>
              Fields marked <span className="font-medium text-[#141C24]">Required</span> must be
              present and understood before a submission can go through. Where a field is marked{' '}
              <span className="font-medium text-[#141C24]">One of a pair</span>, at least one of the
              two must be present — neither is needed on its own, but a submission with neither is
              held for review.
            </p>
            <p>
              Everything else is optional to send. Some of it still earns its place: each field
              below says what we can do with it, and what we can't do without it. A submission
              missing one of those goes through, and the application says plainly what is
              unavailable as a result — nothing is dropped quietly.
            </p>
          </Card>
        </section>

        <Tabs items={TABS} value={tab} onChange={setTab} />

        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium text-gray-700">
              Endpoint <Code>POST {active.path}</Code>
            </h2>
            <p className="mt-1 text-sm text-gray-500">{active.blurb}</p>
          </div>
          <pre className="overflow-x-auto rounded-[12px] border border-[#E4E7EC] bg-[#141C24] p-4 font-mono text-[12px] leading-relaxed text-[#E4E7EC]">
            {example}
          </pre>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-gray-700">Fields we recognise</h2>
          {tab === 'applications' &&
            REQUIRED_ONE_OF_GROUPS.map((group) => (
              <p
                key={group.join('-')}
                className="rounded-[12px] bg-[#FEF7EB] px-4 py-3 text-sm leading-relaxed text-[#9B6916]"
              >
                Send a <strong>{describeOneOfGroup(group)}</strong>. Applicants hold one or the
                other, so neither is required by itself — but with neither there is no register to
                check, and the application can never be screened for due diligence. A submission
                with neither waits in the review queue.
              </p>
            ))}
          {tab === 'applications' &&
            EXPECTED_ONE_OF_GROUPS.map((group) => (
              <p
                key={group.keys.join('-')}
                className="rounded-[12px] bg-gray-50 px-4 py-3 text-sm leading-relaxed text-gray-600"
              >
                Send a <strong>{describeOneOfGroup(group.keys)}</strong> — either one answers the
                question, so there is no need to send both. Unlike the pair above, neither holds a
                submission: send neither and the application is still created, noting that no
                budget was captured. A document is shown to reviewers as a link; only line items
                feed the budget breakdown and the Custodian score.
              </p>
            ))}
          <Card className="divide-y divide-gray-100">
            {active.fields.map((f) => (
              <div key={f.key} className="px-5 py-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium text-[#141C24]">{f.label}</span>
                  {TIER_BADGE[f.tier] && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TIER_BADGE[f.tier]!.className}`}
                    >
                      {TIER_BADGE[f.tier]!.label}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-[#637083]">{f.description}</p>
                {f.degrades && (
                  <p className="mt-1.5 text-sm leading-relaxed text-[#9B6916]">
                    If you don't send it: {f.degrades}
                  </p>
                )}
              </div>
            ))}
          </Card>
        </section>
      </div>
    </SettingsPage>
  )
}
