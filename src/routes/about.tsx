import { useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { LogoMark } from '../components/ui/LogoMark'
import '../styles/about.css'

/**
 * The public explainer. A sibling of `/sign-in` rather than a child of
 * `_authenticated`, so it is reachable signed-out — the auth guard lives only on that
 * layout route, and there is no guard on `__root`.
 *
 * Everything visual is scoped under `.about` (see `styles/about.css`), because
 * `globals.css` loads on every route and this page needs a type scale the app
 * deliberately cannot express.
 */

const ORIGIN = 'https://custodian.fund'
const DESCRIPTION =
  'Custodian brings assessment, awards, payments, reporting, governance and impact into a single system, across the whole grant lifecycle.'

export const Route = createFileRoute('/about')({
  head: () => ({
    meta: [
      { title: 'Custodian — grant management for foundations' },
      { name: 'description', content: DESCRIPTION },
      { property: 'og:title', content: 'Custodian' },
      { property: 'og:description', content: DESCRIPTION },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: `${ORIGIN}/about` },
      { property: 'og:image', content: `${ORIGIN}/about/dashboard.webp` },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  }),
  component: About,
})

const STAGES = [
  { id: 'applications', n: '01', label: 'Applications' },
  { id: 'partnerships', n: '02', label: 'Partnerships' },
  { id: 'voting', n: '03', label: 'Trustee voting' },
  { id: 'finance', n: '04', label: 'Finance' },
  { id: 'reporting', n: '05', label: 'Reporting' },
  { id: 'roles', n: '06', label: 'A view for every role' },
] as const

function About() {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const revealables = Array.from(document.querySelectorAll<HTMLElement>('.about .reveal'))

    if (reduce || !('IntersectionObserver' in window)) {
      revealables.forEach((el) => el.classList.add('in'))
      return
    }

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            revealObserver.unobserve(e.target)
          }
        })
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
    )
    revealables.forEach((el) => revealObserver.observe(el))

    // Mark the current lifecycle stage on the rail. The topmost visible stage wins, so
    // scrolling up and down lands on the same stage rather than flickering between two.
    const stages = Array.from(document.querySelectorAll<HTMLElement>('.about .stage'))
    const items = new Map<string, Element>()
    document
      .querySelectorAll<HTMLElement>('.about .rail li')
      .forEach((li) => li.dataset['rail'] && items.set(li.dataset['rail'], li))

    const visible = new Set<string>()
    const stageObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) visible.add(e.target.id)
          else visible.delete(e.target.id)
        })
        const active = stages.find((s) => visible.has(s.id))?.id
        if (active) items.forEach((li, id) => li.classList.toggle('on', id === active))
      },
      { rootMargin: '-15% 0px -55% 0px', threshold: 0 },
    )
    stages.forEach((s) => stageObserver.observe(s))
    items.get('applications')?.classList.add('on')

    return () => {
      revealObserver.disconnect()
      stageObserver.disconnect()
    }
  }, [])

  return (
    <div className="about">
      {/* The figures fade in on scroll, which means they start at `opacity: 0` and rely
          on JS to become visible. With scripting off that hides eight screenshots on a
          public page. The SSR'd markup is already complete, so this is the whole fix. */}
      <noscript>
        <style
          dangerouslySetInnerHTML={{
            __html: '.about .reveal{opacity:1!important;transform:none!important}',
          }}
        />
      </noscript>

      <a className="skip no-print" href="#main">
        Skip to content
      </a>

      <header className="topbar no-print">
        <div className="wrap topbar-in">
          <a className="brandmark" href="#top" aria-label="Custodian, back to top">
            <LogoMark className="h-9 w-9" />
            <span>
              Custodian<span className="dot">.</span>
            </span>
          </a>
          <span className="stamp">Coming soon</span>
        </div>
      </header>

      <main id="main">
        <span id="top" />

        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <section className="hero">
          <div className="wrap">
            <span className="eyebrow">Grant management for foundations</span>
            <h1 className="wordmark">
              Custodian<span className="dot">.</span>
            </h1>
            <p className="hero-lede">The whole grant lifecycle, for the whole foundation team.</p>
            <div className="hero-meta">
              <span>
                <b>One system</b> — assessment to impact
              </span>
              <span>
                <b>Audit-ready</b> by default
              </span>
              <span>
                <b>UK &amp; EEA</b> data residency
              </span>
            </div>
          </div>
          <div className="wrap hero-plate">
            <figure className="reveal">
              <div className="plate plate-crop plate-hero">
                <img
                  src="/about/dashboard.webp"
                  srcSet="/about/dashboard.webp 1440w, /about/dashboard-2x.webp 2880w"
                  sizes="(min-width: 1308px) 1052px, (min-width: 700px) calc(100vw - 96px), calc(100vw - 40px)"
                  alt="The Custodian dashboard: applications, review, finance and reports counts across the top, with what needs attention today and the round's remaining budget below."
                  width={1440}
                  height={1024}
                  fetchPriority="high"
                />
              </div>
            </figure>
          </div>
        </section>

        {/* ── The problem ────────────────────────────────────────────────── */}
        <section className="band">
          <div className="wrap two-col">
            <span className="eyebrow">The problem</span>
            <h2 className="h2">Giving has outgrown the spreadsheet.</h2>
            <div className="prose">
              <p>
                Grant-making still runs on spreadsheets, inboxes and disconnected systems:
                fragmented intake, case-by-case due diligence, board papers built from scratch,
                bank details and reports chased by hand, and no clear view of impact.
              </p>
              <p>
                Giving is growing — but so is regulation, and manual, fragmented work no longer
                scales.
              </p>
            </div>
          </div>
        </section>

        {/* ── What it is ─────────────────────────────────────────────────── */}
        <section className="band">
          <div className="wrap two-col">
            <span className="eyebrow">What Custodian is</span>
            <h2 className="h2">One intelligent layer, across the whole grant lifecycle.</h2>
            <div className="prose">
              <p>
                Custodian brings assessment, awards, payments, reporting, governance and impact
                into a single system. AI runs through every stage — assessing, scoring, tracking
                and reconciling — and shows its working at each step, while every final decision
                stays with your team.
              </p>
              <p>
                It is audit-ready by default. Every decision, payment and report leaves a
                complete, timestamped trail, so board scrutiny, compliance checks and regulator
                requests are answered from one source of truth.
              </p>
            </div>
          </div>
        </section>

        {/* ── Lifecycle ──────────────────────────────────────────────────── */}
        <section className="band">
          <div className="wrap" style={{ marginBottom: 'clamp(32px, 6vh, 64px)' }}>
            <span className="eyebrow">Across the giving lifecycle</span>
            <h2 className="h2" style={{ maxWidth: '16ch' }}>
              Every stage, in one connected flow.
            </h2>
          </div>

          <div className="wrap lifecycle">
            <nav className="rail no-print" aria-label="Lifecycle stages">
              <ol>
                {STAGES.map((s) => (
                  <li key={s.id} data-rail={s.id}>
                    <a href={`#${s.id}`}>
                      <span className="n">{s.n}</span>
                      {s.label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            <div>
              <article className="stage" id="applications">
                <div className="stage-head">
                  <span className="stage-n">01</span>
                  <h3>Applications</h3>
                </div>
                <div className="prose">
                  <p>
                    Inbound applications arrive in one clean, readable view, each showing its
                    submission date, funding round and programme. AI performs first-pass due
                    diligence as they land — drawing on integrated UK data sources such as the
                    Charity Commission, Companies House, OSCR and 360Giving, alongside wider web
                    presence — flagging inconsistencies, limited delivery track record,
                    financial-health concerns and budget irregularities.
                  </p>
                  <p>
                    Each application is then assessed and ranked against the fund's own criteria,
                    held in the platform as a living strategy document, giving your team an
                    evidence-based starting point rather than a blank page. Human review and
                    commentary sit alongside the automated assessment, and the AI refines to the
                    fund's approach over time.
                  </p>
                </div>
                <div className="figs">
                  <figure className="reveal">
                    <div className="plate-label">Applications list</div>
                    <div className="plate plate-crop">
                      <img
                        src="/about/applications-list.webp"
                        srcSet="/about/applications-list.webp 1440w, /about/applications-list-2x.webp 2880w"
                        sizes="(min-width: 1308px) 1052px, (min-width: 700px) calc(100vw - 96px), calc(100vw - 40px)"
                        alt="The applications list: each row showing organisation, submission date, funding round, programme and AI score."
                        width={1440}
                        height={1036}
                        loading="lazy"
                      />
                    </div>
                  </figure>
                  <figure className="reveal drill">
                    <div className="drill-label">
                      <span className="arrow" aria-hidden="true">
                        ↳
                      </span>
                      Opens the application detail
                    </div>
                    <div className="plate plate-crop">
                      <img
                        src="/about/application-detail.webp"
                        srcSet="/about/application-detail.webp 1440w, /about/application-detail-2x.webp 2880w"
                        sizes="(min-width: 1308px) 1052px, (min-width: 700px) calc(100vw - 96px), calc(100vw - 40px)"
                        alt="Application detail for Nature Learning Network, showing the AI assessment and score breakdown, eligibility flags, budget split and due-diligence checks."
                        width={1440}
                        height={1895}
                        loading="lazy"
                      />
                    </div>
                    <figcaption>
                      Every application carries its AI assessment and score breakdown, eligibility
                      flags, budget split, due-diligence checks and the team's commentary in one
                      record.
                    </figcaption>
                  </figure>
                </div>
              </article>

              <article className="stage" id="partnerships">
                <div className="stage-head">
                  <span className="stage-n">02</span>
                  <h3>Partnerships</h3>
                </div>
                <div className="prose">
                  <p>
                    Not all giving begins with an application. Sourced partners are logged, invited
                    to submit an expression of interest, and carried through the same eligibility,
                    due diligence and scoring as inbound applications — so proactive funding meets
                    the same standard.
                  </p>
                </div>
              </article>

              <article className="stage" id="voting">
                <div className="stage-head">
                  <span className="stage-n">03</span>
                  <h3>Trustee voting</h3>
                </div>
                <div className="prose">
                  <p>
                    Shortlists arrive as complete board papers: each opportunity with its scoring,
                    team commentary, due-diligence findings and reference links, and an AI summary
                    distilling the proposal to its essentials. Trustees read, comment and vote in a
                    single view — no inboxes, no paperwork — and every question, answer and
                    decision is recorded against the trustee and held in the audit trail.
                  </p>
                </div>
                <div className="figs">
                  <figure className="reveal">
                    <div className="plate-label">Shortlist · to vote</div>
                    <div className="plate">
                      <img
                        src="/about/shortlist-vote.webp"
                        srcSet="/about/shortlist-vote.webp 1440w, /about/shortlist-vote-2x.webp 2880w"
                        sizes="(min-width: 1308px) 1052px, (min-width: 700px) calc(100vw - 96px), calc(100vw - 40px)"
                        alt="The shortlist awaiting trustee decisions: proposed spend against the round budget, then a board paper per application with its score, purpose and recorded votes."
                        width={1440}
                        height={1190}
                        loading="lazy"
                      />
                    </div>
                    <figcaption>
                      Proposed spend against the round budget, then one board paper per shortlisted
                      application — scoring, purpose, cost per beneficiary, and each trustee's
                      recorded vote.
                    </figcaption>
                  </figure>
                </div>
              </article>

              <article className="stage" id="finance">
                <div className="stage-head">
                  <span className="stage-n">04</span>
                  <h3>Finance</h3>
                </div>
                <div className="prose">
                  <p>
                    The work is far from over once a decision is made. Custodian runs the full
                    lifecycle from approval through to payment and reconciliation. Bank-detail
                    verification — one of the most tedious and error-prone jobs in grant admin — is
                    automatic: account name and details are checked, and any mismatch flagged
                    before money moves. Award notifications and compliance guidance issue through
                    the platform, payment schedules run end to end, and every approval and
                    regulatory step is logged.
                  </p>
                </div>
                <div className="figs">
                  <figure className="reveal">
                    <div className="plate-label">Finance</div>
                    <div className="plate plate-crop">
                      <img
                        src="/about/finance.webp"
                        srcSet="/about/finance.webp 1440w, /about/finance-2x.webp 2880w"
                        sizes="(min-width: 1308px) 1052px, (min-width: 700px) calc(100vw - 96px), calc(100vw - 40px)"
                        alt="The finance screen: upcoming payments and grants to pay, with bank-verification status on each."
                        width={1440}
                        height={1024}
                        loading="lazy"
                      />
                    </div>
                  </figure>
                  <figure className="reveal drill">
                    <div className="drill-label">
                      <span className="arrow" aria-hidden="true">
                        ↳
                      </span>
                      Opens the payment detail
                    </div>
                    <div className="plate plate-crop">
                      <img
                        src="/about/payment-detail.webp"
                        srcSet="/about/payment-detail.webp 1440w, /about/payment-detail-2x.webp 2880w"
                        sizes="(min-width: 1308px) 1052px, (min-width: 700px) calc(100vw - 96px), calc(100vw - 40px)"
                        alt="Payment details for Groundwork Trust: grant lifecycle, payment schedule and verified bank details."
                        width={1440}
                        height={1024}
                        loading="lazy"
                      />
                    </div>
                    <figcaption>
                      Grant lifecycle, payment schedule and verified bank details for a single
                      award — every step timestamped as it happens.
                    </figcaption>
                  </figure>
                </div>
              </article>

              <article className="stage" id="reporting">
                <div className="stage-head">
                  <span className="stage-n">05</span>
                  <h3>Reporting</h3>
                </div>
                <div className="prose">
                  <p>
                    Every grant's reporting schedule is tracked in one place, with overdue
                    submissions flagged automatically. As each report arrives, AI reads it against
                    the original application — comparing activities, spend, timelines and intended
                    beneficiaries — and surfaces where delivery diverges: underspend, timeline
                    slippage, scope change, unmet milestones. Nothing is cross-referenced or chased
                    by hand.
                  </p>
                </div>
              </article>

              <article className="stage" id="roles">
                <div className="stage-head">
                  <span className="stage-n">06</span>
                  <h3>A view for every role</h3>
                </div>
                <div className="prose">
                  <p>
                    Every user sees a curated, permission-based view of the activity relevant to
                    them. Operations, finance and trustees each work from the same live record,
                    from the angle their role requires — without searching for it, requesting it,
                    or waiting for someone to compile it.
                  </p>
                </div>
                <div className="figs">
                  <figure className="reveal">
                    <div className="plate-label">Dashboard</div>
                    <div className="plate">
                      <img
                        src="/about/dashboard.webp"
                        srcSet="/about/dashboard.webp 1440w, /about/dashboard-2x.webp 2880w"
                        sizes="(min-width: 1308px) 1052px, (min-width: 700px) calc(100vw - 96px), calc(100vw - 40px)"
                        alt="The dashboard: what needs reviewing, voting, paying or chasing today, alongside the round's remaining budget and giving so far."
                        width={1440}
                        height={1024}
                        loading="lazy"
                      />
                    </div>
                    <figcaption>
                      Each role opens onto its own desk: what needs reviewing, voting, paying or
                      chasing today, alongside the round's remaining budget.
                    </figcaption>
                  </figure>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* ── Insights ───────────────────────────────────────────────────── */}
        <section className="band band-quiet" id="insight">
          <div className="wrap">
            <div className="two-col">
              <span className="eyebrow">Portfolio insight — our flagship</span>
              <h2 className="h2">See your giving whole, for the first time.</h2>
              <div className="prose">
                <p>
                  Most foundations struggle to see their giving as a whole. When it is time to
                  report to the board or publish an annual review, teams piece it together from
                  scattered sources — and the result rarely reflects the true depth of the work.
                </p>
                <p>
                  Custodian keeps a live, consolidated view of the entire portfolio: commitments by
                  theme, geography, organisation type and period, with real grantee outcomes
                  surfaced alongside the financial totals. Geographic reach is mapped against
                  indices of deprivation — showing not just where giving goes, but the relative
                  need of the communities it reaches.
                </p>
                <p>
                  And because everything sits in one place, your team can ask a question of the
                  whole portfolio in plain language and get an answer drawn from every grant.
                </p>
              </div>
            </div>
            <figure className="reveal" style={{ marginTop: 'clamp(30px, 6vh, 60px)' }}>
              <div className="plate-label">Insights</div>
              <div className="plate">
                <img
                  src="/about/insights.webp"
                  srcSet="/about/insights.webp 1440w, /about/insights-2x.webp 2880w"
                  sizes="(min-width: 1308px) 1052px, (min-width: 700px) calc(100vw - 96px), calc(100vw - 40px)"
                  alt="The insights screen: committed spend by programme, commitment over time, dominant themes, and geographic reach mapped against deprivation."
                  width={1440}
                  height={1356}
                  loading="lazy"
                />
              </div>
              <figcaption>
                The whole portfolio in one live view — committed spend by programme, commitment
                over time, dominant themes, and geographic reach mapped against deprivation.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* ── Trust ──────────────────────────────────────────────────────── */}
        <section className="band">
          <div className="wrap">
            <div className="two-col">
              <span className="eyebrow">Trust by design</span>
              <h2 className="h2">Built for the standards foundations answer to.</h2>
              <div className="prose">
                <p>
                  Custodian is built for GDPR from the ground up. An immutable, tamper-proof audit
                  trail records every access and every change, and structured tooling supports
                  subject-access and erasure requests within statutory windows. Full
                  data-governance documentation — residency, processing, retention and consent —
                  is available for review.
                </p>
              </div>
            </div>
            <dl className="trust-grid">
              <div className="trust-cell">
                <dt>Residency</dt>
                <dd>All customer data hosted in the UK or EEA. Never on US servers.</dd>
              </div>
              <div className="trust-cell">
                <dt>Processing</dt>
                <dd>A formal Data Processing Agreement is provided to every customer.</dd>
              </div>
              <div className="trust-cell">
                <dt>Model training</dt>
                <dd>Customer data is never used to train AI models.</dd>
              </div>
              <div className="trust-cell">
                <dt>Audit trail</dt>
                <dd>Every access and change recorded, immutably and in full.</dd>
              </div>
            </dl>
          </div>
        </section>

        {/* ── Close ──────────────────────────────────────────────────────── */}
        <section className="band">
          <div className="wrap two-col two-col-close">
            <span className="eyebrow">Built from inside the sector</span>
            <p className="close-quote">By people who have lived this work.</p>
            <div className="prose">
              <p>
                Custodian is designed by a foundation chief executive with a twenty-year career
                leading grant-making foundations, built by a leading cyber-security engineer, and
                developed in collaboration with national foundations.
              </p>
              <p>
                It brings a grant-making foundation's whole world into one place — designed by the
                people who understand it, because it is theirs.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap foot-in">
          <span>custodian.fund</span>
          <span>Coming soon</span>
        </div>
      </footer>
    </div>
  )
}
