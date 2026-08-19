import { useEffect, useState } from 'react'
import { ReviewQueue } from './ReviewQueue'
import { ReportQueue } from './ReportQueue'
import { Mappings } from './Mappings'
import { Clients } from './Clients'
import { Overview } from './Overview'
import { TestSubmissions } from './TestSubmissions'
import { API_BASE } from './api'
import { attentionCount, useQueues } from './queues'

// ─── Shell ───────────────────────────────────────────────────────────────────
//
// The nav used to be eight peer tabs in a row — three of them test submitters, two
// of them views of the same table — which made the app read as eight unrelated
// screens and gave no hint where to start. It is now grouped by what you came here
// to do, with the queues carrying a count so a stuck submission announces itself
// instead of waiting to be found.

export type View =
  | 'overview'
  | 'applications'
  | 'reports'
  | 'foundations'
  | 'mappings'
  | 'testing'

/** A deep link from the Overview into a queue, pre-filtered to the bucket clicked. */
export type QueueFocus =
  | 'all'
  | 'held'
  | 'out-of-round'
  | 'stalled'
  | 'processing'
  | 'confirm'
  | 'need-grant'
  | 'done'

interface NavGroup {
  label: string
  items: Array<{ key: View; label: string; hint: string; badge?: number }>
}

export default function App() {
  const [view, setView] = useState<View>('overview')
  const [focus, setFocus] = useState<QueueFocus>('all')
  const { buckets, reload } = useQueues()

  // Queue counts age quickly — a submission sent from the Testing tab lands seconds
  // later — so refresh on an interval while somebody is actually watching, and
  // immediately whenever the tab is brought back.
  //
  // **Only while visible**, which is the whole point. Each tick is six requests (three
  // active statuses across two endpoints) — and was TWELVE until `Access-Control-Max-Age`
  // was added on the server, since `x-admin-token` made every call preflight. So a tab
  // left open on another screen was a dozen Worker invocations every 30s, indefinitely,
  // for counts nobody was reading. That is also why the database never autosuspended: on
  // 18 Aug 2026 this poll kept the compute awake for three and a half hours straight. On
  // Neon's free plan a single forgotten tab bills several times the monthly allowance.
  //
  // The 30s cadence itself is kept — when someone IS looking, that was a deliberate
  // call and the forgotten tab was the actual cost.
  //
  // `visibilitychange` rather than `focus`: switching tabs within one window does not
  // reliably fire `focus`, so coming back to the queue could sit on stale counts for a
  // full interval. This fixes that as a side effect of fixing the cost.
  useEffect(() => {
    let id: number | undefined
    const stop = () => {
      if (id !== undefined) clearInterval(id)
      id = undefined
    }
    const start = () => {
      stop()
      id = window.setInterval(reload, 30_000)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        reload()
        start()
      } else {
        stop()
      }
    }

    // Mount starts the timer only — `useQueues` has already done the first fetch.
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [reload])

  const appsWaiting =
    buckets.stalled.length +
    buckets.outOfRound.length +
    buckets.needsMapping.length +
    buckets.awaitingConfirmation.length
  const reportsWaiting =
    buckets.reportsStalled.length +
    buckets.reportsNeedGrant.length +
    buckets.reportsNeedsMapping.length +
    buckets.reportsAwaitingConfirmation.length

  const groups: NavGroup[] = [
    {
      label: 'Queues',
      items: [
        {
          key: 'overview',
          label: 'Overview',
          hint: 'What needs attention',
          badge: attentionCount(buckets),
        },
        {
          key: 'applications',
          label: 'Applications',
          hint: 'Incoming grant applications',
          badge: appsWaiting,
        },
        {
          key: 'reports',
          label: 'Grant reports',
          hint: 'Incoming grantee reports',
          badge: reportsWaiting,
        },
      ],
    },
    {
      label: 'Configuration',
      items: [
        { key: 'foundations', label: 'Foundations', hint: 'Tenants and their admins' },
        { key: 'mappings', label: 'Field mappings', hint: 'Learned field-name lookups' },
      ],
    },
    {
      label: 'Testing',
      items: [{ key: 'testing', label: 'Send test data', hint: 'Exercise the live endpoints' }],
    },
  ]

  function go(next: View, nextFocus: QueueFocus = 'all') {
    setView(next)
    setFocus(nextFocus)
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <p className="text-sm font-semibold tracking-tight">Custodian Admin</p>
          <EnvironmentLabel />
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = view === item.key
                  return (
                    <button
                      key={item.key}
                      onClick={() => go(item.key)}
                      title={item.hint}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                        active
                          ? 'bg-indigo-50 font-medium text-indigo-700'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                    >
                      <span className="truncate">{item.label}</span>
                      {item.badge ? (
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                            active ? 'bg-indigo-600 text-white' : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {item.badge}
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1">
        {view === 'overview' && <Overview onNavigate={go} />}
        {view === 'applications' && <ReviewQueue focus={focus} onFocusChange={setFocus} />}
        {view === 'reports' && <ReportQueue focus={focus} onFocusChange={setFocus} />}
        {view === 'foundations' && <Clients />}
        {view === 'mappings' && <Mappings />}
        {view === 'testing' && <TestSubmissions />}
      </main>
    </div>
  )
}

/**
 * Which backend this build is pointed at. Worth a permanent line in the chrome: the
 * app is built against one of local / staging / prod via VITE_API_BASE, the screens
 * look identical either way, and the actions here delete applications and create
 * foundations.
 */
function EnvironmentLabel() {
  const host = API_BASE.replace(/^https?:\/\//, '')
  const isLocal = /localhost|127\.0\.0\.1/.test(API_BASE)
  const isStaging = /staging/.test(API_BASE)
  const tone = isLocal
    ? 'bg-slate-100 text-slate-600'
    : isStaging
      ? 'bg-sky-100 text-sky-800'
      : 'bg-rose-100 text-rose-800'
  const name = isLocal ? 'local' : isStaging ? 'staging' : 'production'
  return (
    <span
      title={`API base: ${API_BASE}`}
      className={`mt-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}
    >
      {name} · {host}
    </span>
  )
}
