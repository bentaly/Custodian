import { describe, expect, it } from 'vitest'
import { diagnoseIngest, STUCK_AFTER_MS, type DiagnosableIngest } from './diagnose'

// `diagnoseIngest` is the pure half: all IO is pre-loaded into the programme index,
// so the reasons an ingest is held can be tested without a database.

const emptyIndex = { known: new Map<string, Set<string>>(), open: new Map<string, Set<string>>() }

function indexWith(clientId: string, opts: { known?: string[]; open?: string[] }) {
  return {
    known: new Map([[clientId, new Set((opts.known ?? []).map((n) => n.toLowerCase()))]]),
    open: new Map([[clientId, new Set((opts.open ?? []).map((n) => n.toLowerCase()))]]),
  }
}

const CLIENT = 'client-1'

/** A submission that maps cleanly: every required field present, a charity number,
 *  and a round programme already resolved. Individual tests break one thing. */
function cleanIngest(overrides: Partial<DiagnosableIngest> = {}): DiagnosableIngest {
  const rawPayload: Record<string, unknown> = {
    prog: 'Youth Fund',
    ref: 'APP-1',
    org: 'Test Charity',
    email: 'grants@example.org',
    amount: '15000',
    bank: 'Barclays',
    accName: 'Test Charity',
    accNo: '12345678',
    sort: '20-00-00',
    charity: '219279',
  }
  const resolved: Record<string, string> = {
    prog: 'programmeName',
    ref: 'externalApplicationId',
    org: 'organisationName',
    email: 'applicantEmail',
    amount: 'amountRequested',
    bank: 'bankName',
    accName: 'bankAccountName',
    accNo: 'bankAccountNumber',
    sort: 'bankSortCode',
    charity: 'charityNumber',
  }
  return {
    id: 'ingest-1',
    clientId: CLIENT,
    status: 'needs_review',
    rawPayload,
    resolved,
    roundProgrammeId: 'rp-1',
    applicationId: null,
    createdAt: new Date(),
    ...overrides,
  }
}

const codes = (blockers: Array<{ code: string }>) => blockers.map((b) => b.code)

describe('diagnoseIngest', () => {
  it('calls a fresh `received` row processing, not broken', () => {
    const blockers = diagnoseIngest(cleanIngest({ status: 'received' }), emptyIndex)
    expect(codes(blockers)).toEqual(['pipeline_running'])
    expect(blockers[0]!.severity).toBe('info')
  })

  it('calls a `received` row past the patience window stalled', () => {
    // The distinction the queue could not previously make: same column value, but one
    // wants patience and the other only moves if someone presses Reprocess.
    const row = cleanIngest({
      status: 'received',
      createdAt: new Date(Date.now() - STUCK_AFTER_MS - 1000),
    })
    const blockers = diagnoseIngest(row, emptyIndex)
    expect(codes(blockers)).toEqual(['pipeline_stalled'])
    expect(blockers[0]!.severity).toBe('blocking')
    expect(blockers[0]!.fix).toMatch(/Reprocess/)
  })

  it('reports nothing for a completed row', () => {
    expect(diagnoseIngest(cleanIngest({ status: 'complete' }), emptyIndex)).toEqual([])
  })

  it('names every required field that never resolved', () => {
    const row = cleanIngest()
    delete row.resolved!['accNo']
    delete row.resolved!['email']
    const blockers = diagnoseIngest(row, emptyIndex)
    const required = blockers.find((b) => b.code === 'required_unmapped')!
    expect(required.severity).toBe('blocking')
    expect(required.fields!.map((f) => f.key).sort()).toEqual([
      'applicantEmail',
      'bankAccountNumber',
    ])
  })

  it('reports an unmet one-of group when neither register number resolved', () => {
    const row = cleanIngest()
    delete row.resolved!['charity']
    const blockers = diagnoseIngest(row, emptyIndex)
    const oneOf = blockers.find((b) => b.code === 'one_of_unmet')!
    expect(oneOf.severity).toBe('blocking')
    expect(oneOf.fields!.map((f) => f.key)).toEqual(['charityNumber', 'companyNumber'])
    // The reason matters more than the rule: this is the hold that stops an
    // unscreenable application looking screened.
    expect(oneOf.detail).toMatch(/due diligence/)
  })

  it('accepts a company number alone as satisfying the one-of group', () => {
    const row = cleanIngest()
    delete row.resolved!['charity']
    row.rawPayload['company'] = '03782379'
    row.resolved!['company'] = 'companyNumber'
    expect(codes(diagnoseIngest(row, emptyIndex))).not.toContain('one_of_unmet')
  })

  it('surfaces a value that maps but fails validation', () => {
    // The case with no visible symptom before: the mapping grid is complete, so the
    // row looked ready to promote while sitting in needs_review forever.
    const row = cleanIngest()
    row.rawPayload['amount'] = 'about fifteen thousand pounds'
    const blockers = diagnoseIngest(row, emptyIndex)
    const invalid = blockers.find((b) => b.code === 'invalid_value')!
    expect(invalid).toBeDefined()
    expect(invalid.fields!.map((f) => f.key)).toContain('amountRequested')
    expect(invalid.fields![0]!.message).toBeTruthy()
  })

  it('does not report a missing required field twice as an invalid value', () => {
    const row = cleanIngest()
    delete row.resolved!['amount']
    const blockers = diagnoseIngest(row, emptyIndex)
    expect(blockers.filter((b) => b.fields?.some((f) => f.key === 'amountRequested'))).toHaveLength(
      1,
    )
  })

  it('distinguishes a programme that does not exist from one whose round is shut', () => {
    const unrouted = cleanIngest({ roundProgrammeId: null })

    const unknown = diagnoseIngest(unrouted, indexWith(CLIENT, { known: ['Other Fund'] }))
    expect(codes(unknown)).toContain('programme_unknown')

    const closed = diagnoseIngest(
      unrouted,
      indexWith(CLIENT, { known: ['Youth Fund'], open: ['Other Fund'] }),
    )
    expect(codes(closed)).toContain('programme_not_open')

    // The two want completely different remedies — rename the programme, versus
    // reopen the round — which is why they are not one "out of round" message.
    const notOpen = closed.find((b) => b.code === 'programme_not_open')!
    expect(notOpen.fix).toMatch(/Reopen|extend/i)
  })

  it('reports no programme name at all separately from an unmatched one', () => {
    const row = cleanIngest({ roundProgrammeId: null })
    delete row.resolved!['prog']
    const blockers = diagnoseIngest(row, emptyIndex)
    expect(codes(blockers)).toContain('programme_unmapped')
    expect(codes(blockers)).not.toContain('programme_unknown')
  })

  it('stays quiet about routing once a round programme is resolved', () => {
    const blockers = diagnoseIngest(cleanIngest(), emptyIndex)
    expect(codes(blockers).some((c) => c.startsWith('programme_'))).toBe(false)
  })

  it('never returns an empty explanation for a held row', () => {
    // An empty panel on a stuck submission reads as "nothing wrong", which is the
    // exact impression that made the original bug invisible.
    const blockers = diagnoseIngest(cleanIngest(), emptyIndex)
    expect(blockers.length).toBeGreaterThan(0)
    expect(blockers.every((b) => b.title && b.detail && b.fix)).toBe(true)
  })

  it('treats an ai_proposed row as awaiting confirmation, not blocked', () => {
    const blockers = diagnoseIngest(
      cleanIngest({ status: 'ai_proposed', applicationId: 'app-1' }),
      emptyIndex,
    )
    expect(blockers).toHaveLength(1)
    expect(blockers[0]!.severity).toBe('info')
  })
})
