import type { ReactNode } from 'react'

/**
 * Split layout for the signed-out screens. The left panel is brand-only and drops
 * away under `lg`, where the form takes the full width.
 *
 * The art is the product's own ticked meter — the same device the dashboard uses for
 * round budgets and stat tiles — rather than decoration invented for this page. The
 * six-segment code input on the sign-in form is the same motif at a smaller scale.
 */

export function LogoMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <span className={`flex items-center justify-center rounded-xl bg-moss-100 ${className}`}>
      <svg viewBox="0 0 24 24" className="h-[55%] w-[55%]" aria-hidden>
        <path d="M 17.2 7 A 7.5 7.5 0 1 0 17.2 17" fill="none" stroke="#17795A" strokeWidth="5" />
        <rect x="14.6" y="9.9" width="4.6" height="4.6" fill="#17795A" />
      </svg>
    </span>
  )
}

// Tick count is tuned to the panel width so the pitch lands near the dashboard's
// budget meter (~3px tick, ~5px gap) rather than reading as fat pills.
const TICKS = 64

/** One allocation meter: `ratio` of the ticks are lit, the rest sit as the unspent track. */
function TickBar({
  ratio,
  lit,
  track,
  delay,
}: {
  ratio: number
  lit: string
  track: string
  delay: number
}) {
  const filled = Math.round(TICKS * ratio)
  return (
    // justify-between spreads fixed-width ticks across the full column, so the meter
    // lines up with its label row (like the dashboard's round-budget bar) while the
    // ticks stay thin instead of stretching into pills.
    <div className="flex h-8 items-end justify-between">
      {Array.from({ length: TICKS }).map((_, i) => (
        <span
          key={i}
          className="tick h-full w-[3px] rounded-full"
          style={{
            backgroundColor: i < filled ? lit : track,
            // Stagger left-to-right so the bars read as filling, not appearing.
            animationDelay: `${delay + i * 12}ms`,
          }}
        />
      ))}
    </div>
  )
}

const BARS = [
  { label: 'Community & Place', ratio: 0.5, lit: '#8FD4B0', track: '#E9F7EF', delay: 120 },
  { label: 'Young People', ratio: 0.64, lit: '#F0A8C0', track: '#FDF0F4', delay: 260 },
  { label: 'Environment', ratio: 0.875, lit: '#F2C879', track: '#FDF6E3', delay: 400 },
]

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-white">
      <aside className="relative hidden w-[46%] max-w-[620px] shrink-0 overflow-hidden border-r border-hairline bg-canvas lg:flex lg:flex-col lg:justify-between">
        {/* The dotted grid from behind the dashboard's giving chart. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            backgroundImage: 'radial-gradient(#DDE4E0 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: 'linear-gradient(160deg, #EFF7F2 0%, rgba(250,251,250,0) 55%)' }}
        />

        <div className="relative flex items-center gap-3 p-10">
          <LogoMark />
          <span className="text-[19px] font-bold tracking-tight text-ink">Custodian</span>
        </div>

        <div className="relative px-10">
          <h2
            className="font-display text-[44px] font-semibold leading-[1.05] text-ink"
            style={{ textWrap: 'balance', maxWidth: '11ch' }}
          >
            Every grant, end to end.
          </h2>
          <p className="mt-4 max-w-[38ch] text-[15px] leading-relaxed text-ink-muted">
            Funding rounds, applications, decisions and reporting — in one place, for the people who
            look after the money.
          </p>

          <div className="mt-12 space-y-5" aria-hidden>
            {BARS.map((b) => (
              <div key={b.label}>
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-[13px] font-medium text-ink-soft">{b.label}</span>
                  <span className="text-[13px] tabular-nums text-ink-muted">
                    {Math.round(b.ratio * 100)}%
                  </span>
                </div>
                <TickBar ratio={b.ratio} lit={b.lit} track={b.track} delay={b.delay} />
              </div>
            ))}
          </div>
        </div>

        <p className="relative p-10 text-[13px] text-ink-muted">
          Custodian is invite-only. Your administrator can send you an invitation.
        </p>
      </aside>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[380px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <LogoMark className="h-8 w-8" />
            <span className="text-[17px] font-bold tracking-tight text-ink">Custodian</span>
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}
