// ─── Building one foundation's brief, from the database ──────────────────────
//
// The read side of the portfolio analysis. It goes through `insightsData` — the
// same function the Insights screen's loader calls — rather than querying grants
// itself, because the paragraph is printed on top of that screen and must be made
// of the same grants it draws. A second query here would eventually disagree with
// it about a cancelled grant or an imported impact figure.
//
// There is no session: this runs on the queue, for one client, named explicitly.
// So the tenant scope is derived from the client id directly rather than from a
// caller (`visibleRoundProgrammeIds` needs a user), and it is derived the same
// way — the set of `round_programmes` belonging to that client's programmes.

import { eq } from 'drizzle-orm'
import type { getDb } from '../db'
import { clientProfiles, programmes, roundProgrammes } from '../../../drizzle/schema'
import { insightsData } from '../fns/insights'
import { buildPortfolioBrief, type PortfolioBrief } from '../../lib/portfolioAnalysis'
import { impactUnitLabel } from '../../lib/impactUnits'

export interface ClientBrief {
  brief: PortfolioBrief
  /** Zero means there is nothing to summarise — the screen shows its empty state. */
  grantCount: number
}

export async function buildClientBrief(
  db: ReturnType<typeof getDb>,
  clientId: string,
): Promise<ClientBrief> {
  const [scope, progs, profile] = await Promise.all([
    db
      .select({ id: roundProgrammes.id })
      .from(roundProgrammes)
      .innerJoin(programmes, eq(roundProgrammes.programmeId, programmes.id))
      .where(eq(programmes.clientId, clientId)),
    db
      .select({
        name: programmes.name,
        goal: programmes.goal,
        impactUnit: programmes.impactUnit,
        impactUnitLabel: programmes.impactUnitLabel,
      })
      .from(programmes)
      .where(eq(programmes.clientId, clientId)),
    db
      .select({ missionStatement: clientProfiles.missionStatement })
      .from(clientProfiles)
      .where(eq(clientProfiles.clientId, clientId))
      .limit(1),
  ])

  // A client with no round-programmes has no grants either, and `inArray(x, [])` is a
  // SQL error — the same short-circuit `getInsights` makes before it queries.
  const items =
    scope.length === 0
      ? []
      : (
          await insightsData(
            db,
            scope.map((r) => r.id),
          )
        ).items

  return {
    grantCount: items.length,
    brief: buildPortfolioBrief(items, {
      missionStatement: profile[0]?.missionStatement ?? null,
      programmes: progs.map((p) => ({
        name: p.name,
        goal: p.goal,
        // The label, not the key: "Items delivered" is what the figures are in, and
        // `items` on its own tells the model nothing about what was counted.
        impactUnit: impactUnitLabel(p.impactUnit, p.impactUnitLabel),
      })),
    }),
  }
}
