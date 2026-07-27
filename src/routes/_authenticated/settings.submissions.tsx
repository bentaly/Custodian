import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Card, Tabs, type TabItem } from '../../components/ui'
import { SettingsPage } from '../../components/SettingsPage'
import { CANONICAL_FIELDS } from '../../lib/fieldMapping/canonical'
import { REPORT_CANONICAL_FIELDS } from '../../lib/fieldMapping/reportCanonical'

export const Route = createFileRoute('/_authenticated/settings/submissions')({
  beforeLoad: ({ context }) => {
    const isAdmin = context.user.role === 'admin' || context.user.role === 'superadmin'
    if (!isAdmin) throw redirect({ to: '/settings' })
  },
  component: Submissions,
})

// Both registries share a shape, so one table renders either. Reading them straight
// from the mapper's source of truth means this page cannot drift out of date.
type Field = { key: string; label: string; required: boolean; description: string }

type Kind = 'applications' | 'reports'

const TABS: TabItem<Kind>[] = [
  { id: 'applications', label: 'Applications' },
  { id: 'reports', label: 'Reports' },
]

const ENDPOINTS = {
  applications: {
    path: '/api/apply',
    blurb:
      'Post a completed application. Every field you send is matched to one of the fields below, including your own application reference.',
    fields: CANONICAL_FIELDS as unknown as Field[],
  },
  reports: {
    path: '/api/submit-report',
    blurb:
      'Post a grant report. Reports link to a grant automatically when your application reference matches one we already hold; anything else waits in the Reports queue for an admin.',
    fields: REPORT_CANONICAL_FIELDS as unknown as Field[],
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
              present and understood before a submission can go through. The rest are optional and
              simply enrich the record.
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
          <Card className="divide-y divide-gray-100">
            {active.fields.map((f) => (
              <div key={f.key} className="px-5 py-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium text-[#141C24]">{f.label}</span>
                  {f.required && (
                    <span className="rounded-full bg-[#FEF0E6] px-2 py-0.5 text-[11px] font-medium text-[#B45309]">
                      Required
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-[#637083]">{f.description}</p>
              </div>
            ))}
          </Card>
        </section>
      </div>
    </SettingsPage>
  )
}
