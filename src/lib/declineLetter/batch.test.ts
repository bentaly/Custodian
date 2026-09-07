import { describe, expect, it } from 'vitest'
import { planDeclineBatch, type DeclineCandidate } from './batch'

const candidate = (
  over: Partial<DeclineCandidate> & { applicationId: string },
): DeclineCandidate => ({
  organisationName: 'Org',
  applicantEmail: 'hello@example.org',
  letterStatus: null,
  ...over,
})

describe('planDeclineBatch', () => {
  it('letters a declined applicant with an address and no letter yet', () => {
    const plan = planDeclineBatch({
      candidates: [candidate({ applicationId: 'a' })],
      previouslyWritten: [],
    })
    expect(plan.toNotify.map((c) => c.applicationId)).toEqual(['a'])
  })

  it('leaves out an application that already has a letter', () => {
    const plan = planDeclineBatch({
      candidates: [candidate({ applicationId: 'a', letterStatus: 'sent' })],
      previouslyWritten: [],
    })
    expect(plan.toNotify).toHaveLength(0)
    expect(plan.alreadyNotified.map((c) => c.applicationId)).toEqual(['a'])
  })

  it('counts a failed letter as already notified rather than re-lettering it', () => {
    // The retry belongs to the row that failed. Writing a second document for the same
    // application is the one thing the unique index exists to stop.
    const plan = planDeclineBatch({
      candidates: [candidate({ applicationId: 'a', letterStatus: 'failed' })],
      previouslyWritten: [],
    })
    expect(plan.toNotify).toHaveLength(0)
    expect(plan.alreadyNotified).toHaveLength(1)
  })

  it('never writes to an address that has had a decline letter before', () => {
    const plan = planDeclineBatch({
      candidates: [candidate({ applicationId: 'a', applicantEmail: 'Hello@Example.org' })],
      previouslyWritten: [
        { email: 'hello@example.org', at: '2025-11-02T09:00:00Z', roundName: 'Autumn 2025' },
      ],
    })
    expect(plan.toNotify).toHaveLength(0)
    expect(plan.addressAlreadyWritten[0]!.previous.roundName).toBe('Autumn 2025')
  })

  it('names the most recent previous letter when an address has several', () => {
    const plan = planDeclineBatch({
      candidates: [candidate({ applicationId: 'a' })],
      previouslyWritten: [
        { email: 'hello@example.org', at: '2024-11-02T09:00:00Z', roundName: 'Autumn 2024' },
        { email: 'hello@example.org', at: '2025-11-02T09:00:00Z', roundName: 'Autumn 2025' },
      ],
    })
    expect(plan.addressAlreadyWritten[0]!.previous.roundName).toBe('Autumn 2025')
  })

  it('sends one letter per address when two applications share a mailbox', () => {
    const plan = planDeclineBatch({
      candidates: [
        candidate({ applicationId: 'a', organisationName: 'First' }),
        candidate({ applicationId: 'b', organisationName: 'Second' }),
      ],
      previouslyWritten: [],
    })
    expect(plan.toNotify.map((c) => c.applicationId)).toEqual(['a'])
    expect(plan.duplicateInBatch.map((c) => c.applicationId)).toEqual(['b'])
  })

  it('treats an address claimed by an already-notified application as spoken for', () => {
    const plan = planDeclineBatch({
      candidates: [
        candidate({ applicationId: 'a', letterStatus: 'sent' }),
        candidate({ applicationId: 'b' }),
      ],
      previouslyWritten: [],
    })
    expect(plan.toNotify).toHaveLength(0)
    expect(plan.duplicateInBatch.map((c) => c.applicationId)).toEqual(['b'])
  })

  it('separates an applicant with no address from one that can be written to', () => {
    const plan = planDeclineBatch({
      candidates: [
        candidate({ applicationId: 'a', applicantEmail: null }),
        candidate({ applicationId: 'b', applicantEmail: 'other@example.org' }),
      ],
      previouslyWritten: [],
    })
    expect(plan.unreachable.map((c) => c.applicationId)).toEqual(['a'])
    expect(plan.toNotify.map((c) => c.applicationId)).toEqual(['b'])
  })

  it('does not let two applicants without an address collide with each other', () => {
    const plan = planDeclineBatch({
      candidates: [
        candidate({ applicationId: 'a', applicantEmail: null }),
        candidate({ applicationId: 'b', applicantEmail: null }),
      ],
      previouslyWritten: [],
    })
    expect(plan.unreachable).toHaveLength(2)
  })
})
