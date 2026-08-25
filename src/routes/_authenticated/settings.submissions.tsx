import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Badge, Panel, PanelTitle, Tabs, type TabItem } from '../../components/ui'
import { C } from '../../components/ui/tokens'
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
    className: 'bg-warning/10 text-warning',
  },
  one_of: {
    label: 'One of a pair',
    className: 'bg-warning/10 text-warning',
  },
  // No badge: an `expected` field is genuinely optional to send. Its cost is spelled
  // out in the description instead, where it reads as guidance rather than a demand.
  expected: null,
  // Nor here — an `optional` field costs nothing at all when it is absent, so there is
  // even less to say about it than an `expected` one.
  optional: null,
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
    <code className="rounded-chip bg-grey-100 px-1.5 py-0.5 font-mono text-label text-grey-900">
      {children}
    </code>
  )
}

function Submissions() {
  const [tab, setTab] = useState<Kind>('applications')
  const active = ENDPOINTS[tab]

  // The live origin rather than a hardcoded host, so the example is copy-pasteable
  // from staging and local dev as well as production — and cannot go stale if the
  // app's address changes.
  const origin = typeof window === 'undefined' ? '' : window.location.origin

  const example = [
    `curl -X POST ${origin}${active.path} \\`,
    `  -H "Authorization: Bearer cust_sk_your_key_here" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{ "Your field name": "value", "Another field": "value" }'`,
  ].join('\n')

  return (
    <SettingsPage
      title="Submitting applications"
      description="How your website or intake form sends applications and reports to Custodian, and what each field should contain."
    >
      <Panel label="How it works">
        <PanelTitle>How it works</PanelTitle>
        <div
          className="flex flex-col gap-3 font-display text-body leading-relaxed"
          style={{ color: C.body }}
        >
          <p>
            Send us a flat object of your own field names and their values — there are no reserved
            keys and no wrapper to build. We match each of your field names to one of the fields
            below, so you can keep calling things whatever your form already calls them.
          </p>
          <p>
            Authenticate with an API key in the <Code>Authorization: Bearer …</Code> header. JSON
            and form-encoded bodies are both accepted. We reply <Code>202 Accepted</Code> straight
            away and do the matching afterwards; anything we can't place with confidence waits in a
            queue rather than being guessed at.
          </p>
          <p>
            Fields marked <span className="font-medium text-grey-900">Required</span> must be
            present and understood before a submission can go through.
            {REQUIRED_ONE_OF_GROUPS.length > 0 && (
              <>
                {' '}
                Where a field is marked{' '}
                <span className="font-medium text-grey-900">One of a pair</span>, at least one of
                the two must be present — neither is needed on its own, but a submission with
                neither is held for review.
              </>
            )}
          </p>
          <p>
            Everything else is optional to send. Some of it still earns its place: each field below
            says what we can do with it, and what we can't do without it. A submission missing one
            of those goes through, and the application says plainly what is unavailable as a result
            — nothing is dropped quietly.
          </p>
        </div>
      </Panel>

      <Panel label="Connecting a form platform">
        <PanelTitle>Connecting a form platform</PanelTitle>
        <div
          className="flex flex-col gap-3 font-display text-body leading-relaxed"
          style={{ color: C.body }}
        >
          <p>
            If your applications already come in through a form builder, you do not need to build
            any of the above. Generate a webhook address on{' '}
            <span className="font-medium text-grey-900">API keys</span> — choosing{' '}
            <span className="font-medium text-grey-900">A form platform</span> — and paste it into
            the form's webhook settings. In Typeform that is{' '}
            <span className="font-medium text-grey-900">Connect → Webhooks → Add a webhook</span>.
            Nothing else to configure, and no field mapping to do up front.
          </p>
          <p>
            We read the platform's own payload and treat each question as one of your field names,
            exactly as though you had posted it yourself. So the fields below still apply — they are
            matched against your questions as written, and anything we can't place with confidence
            waits in a queue rather than being guessed at.
          </p>
          <p>
            The address contains its own key, which is why it is a different key from the one your
            server uses: form platforms cannot send an <Code>Authorization</Code> header, so the
            credential has to travel in the URL. Treat it as a secret, and revoke it the same way if
            it ever needs replacing.
          </p>
        </div>
      </Panel>

      <Tabs items={TABS} value={tab} onChange={setTab} />

      <Panel label="Endpoint">
        <PanelTitle>
          Endpoint <Code>POST {active.path}</Code>
        </PanelTitle>
        <p className="-mt-2 mb-3 font-display text-body" style={{ color: C.sub }}>
          {active.blurb}
        </p>
        <pre
          className="overflow-x-auto rounded-control border p-4 font-mono text-label leading-relaxed"
          style={{ borderColor: C.line, backgroundColor: C.ink, color: C.wash }}
        >
          {example}
        </pre>
      </Panel>

      <Panel label="Fields">
        <PanelTitle
          right={
            <span className="font-display text-label font-medium" style={{ color: C.faint }}>
              {active.fields.length} fields
            </span>
          }
        >
          Fields we recognise
        </PanelTitle>

        <div className="flex flex-col gap-3">
          {tab === 'applications' &&
            REQUIRED_ONE_OF_GROUPS.map((group) => (
              <p
                key={group.join('-')}
                className="rounded-chip px-3 py-2 font-display text-body leading-relaxed"
                style={{ backgroundColor: C.warningWash, color: C.warning }}
              >
                Send a <strong>{describeOneOfGroup(group)}</strong>. Applicants hold one or the
                other, so neither is required by itself — but with neither there is no register to
                check, and the application can never be screened for due diligence. A submission
                with neither waits in the review queue.
              </p>
            ))}
          {/* Each group's own words, not a hard-coded sentence about the budget: the
              registration pair joined this list, and copy written for one pair would
              have quietly described the other one wrongly. */}
          {tab === 'applications' &&
            EXPECTED_ONE_OF_GROUPS.map((group) => (
              <p
                key={group.keys.join('-')}
                className="rounded-chip px-3 py-2 font-display text-body leading-relaxed"
                style={{ backgroundColor: C.wash, color: C.sub }}
              >
                Send a <strong>{describeOneOfGroup(group.keys)}</strong> — either one answers the
                question, so there is no need to send both. Neither is required: send neither and
                the application is still created, saying plainly what is unavailable as a result.{' '}
                {group.degrades}
                {group.note ? ` ${group.note}` : ''}
              </p>
            ))}
        </div>

        <ul className="mt-3 flex flex-col">
          {active.fields.map((f) => (
            <li
              key={f.key}
              className="border-t py-3 first:border-t-0 first:pt-0"
              style={{ borderColor: C.wash }}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-display text-body font-medium" style={{ color: C.ink }}>
                  {f.label}
                </span>
                {TIER_BADGE[f.tier] && (
                  <Badge size="sm" className={TIER_BADGE[f.tier]!.className}>
                    {TIER_BADGE[f.tier]!.label}
                  </Badge>
                )}
              </div>
              <p className="mt-1 font-display text-body leading-relaxed" style={{ color: C.sub }}>
                {f.description}
              </p>
              {f.degrades && (
                <p
                  className="mt-1.5 font-display text-body leading-relaxed"
                  style={{ color: C.warning }}
                >
                  If you don't send it: {f.degrades}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </SettingsPage>
  )
}
