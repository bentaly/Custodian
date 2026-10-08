import { describe, it, expect } from 'vitest'
import { flattenFormstack, isFormstackEnvelope } from './formstack'
import { readEnvelope } from './index'
import { parseSubmissionPayload } from '../submissionPayload'

/** A Formstack delivery: the form's own keys plus Formstack's three. */
function delivery(fields: Record<string, unknown> = {}, handshake: string | null = 'shh') {
  return {
    FormID: '6606394',
    UniqueID: '1500878955',
    ...(handshake === null ? {} : { HandshakeKey: handshake }),
    ...fields,
  }
}

describe('isFormstackEnvelope', () => {
  it('recognises a delivery by its FormID and UniqueID', () => {
    expect(isFormstackEnvelope(delivery())).toBe(true)
  })

  it('leaves an ordinary flat payload alone', () => {
    const flat = { organisationName: 'Rivergate Trust', amountRequested: '25000' }
    expect(isFormstackEnvelope(flat)).toBe(false)
    expect(readEnvelope(flat)).toBeNull()
  })

  it('needs both keys, not just a question that happens to be called FormID', () => {
    expect(isFormstackEnvelope({ FormID: '12', Organisation: 'Rivergate' })).toBe(false)
  })
})

describe('flattenFormstack', () => {
  it('keeps the questions, synthesises the reference, and NEVER keeps the shared secret', () => {
    const flat = flattenFormstack(
      delivery({ 'Organisation name': 'Rivergate Trust', 'Amount requested': '25000' }),
    )
    expect(flat).toEqual({
      'Submission ID': '1500878955',
      'Form ID': '6606394',
      'Organisation name': 'Rivergate Trust',
      'Amount requested': '25000',
    })
    expect(JSON.stringify(flat)).not.toContain('shh')
    expect(flat).not.toHaveProperty('HandshakeKey')
    expect(flat).not.toHaveProperty('FormID')
    expect(flat).not.toHaveProperty('UniqueID')
  })

  it('refuses a test delivery that carries nothing but Formstack keys', () => {
    expect(flattenFormstack(delivery())).toBeNull()
    expect(flattenFormstack(delivery({ 'Organisation name': '  ' }))).toBeNull()
  })

  it('writes a JSON Name field the way a person would', () => {
    const flat = flattenFormstack(
      delivery({ 'Contact name': { last: 'Okafor', first: 'Ada', prefix: '' } }),
    )
    expect(flat?.['Contact name']).toBe('Ada Okafor')
  })

  it('joins an address and a multi-select', () => {
    const flat = flattenFormstack(
      delivery({
        Address: { address: '1 High St', address2: '', city: 'Preston', zip: 'PR1 1AA' },
        Themes: ['Youth', 'Mental health'],
      }),
    )
    expect(flat?.Address).toBe('1 High St, Preston, PR1 1AA')
    expect(flat?.Themes).toBe('Youth, Mental health')
  })

  it('keeps an unfamiliar nested shape verbatim rather than guessing', () => {
    const flat = flattenFormstack(delivery({ Matrix: { row1: { a: 1 } } }))
    expect(flat?.Matrix).toBe('{"row1":{"a":1}}')
  })

  it("lets the form's own question win over a synthesised key", () => {
    const flat = flattenFormstack(delivery({ 'Submission ID': 'WREN-0042' }))
    expect(flat?.['Submission ID']).toBe('WREN-0042')
  })
})

describe('a Formstack delivery at the decode boundary', () => {
  const post = (body: string, type: string) =>
    parseSubmissionPayload(
      new Request('https://custodian.fund/x', {
        method: 'POST',
        headers: { 'content-type': type },
        body,
      }),
    )

  it('is flattened from the default url-encoded form', async () => {
    const result = await post(
      'FormID=6606394&UniqueID=1500878955&HandshakeKey=shh&Organisation+name=Rivergate+Trust',
      'application/x-www-form-urlencoded; charset=utf-8',
    )
    expect(result).toEqual({
      ok: true,
      payload: {
        'Submission ID': '1500878955',
        'Form ID': '6606394',
        'Organisation name': 'Rivergate Trust',
      },
    })
  })

  it('answers an answerless test delivery as unusable, not as a submission', async () => {
    const result = await post(
      'FormID=6606394&UniqueID=1500878955&HandshakeKey=test',
      'application/x-www-form-urlencoded; charset=utf-8',
    )
    expect(result).toEqual({ ok: false, reason: 'unusable' })
  })
})
