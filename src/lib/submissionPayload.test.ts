import { describe, it, expect } from 'vitest'
import { parseSubmissionPayload } from './submissionPayload'

const FIELDS = { 'Organisation name': 'Bradford Youth Trust', 'Amount requested': '25000' }
const JSON_BODY = JSON.stringify(FIELDS)

function post(body: BodyInit, contentType?: string): Request {
  return new Request('https://custodian.fund/api/apply', {
    method: 'POST',
    headers: contentType ? { 'content-type': contentType } : {},
    body,
  })
}

describe('parseSubmissionPayload — headers senders actually send', () => {
  it('reads a correctly labelled JSON body', async () => {
    expect(await parseSubmissionPayload(post(JSON_BODY, 'application/json'))).toEqual(FIELDS)
  })

  it('tolerates a charset suffix', async () => {
    const req = post(JSON_BODY, 'application/json; charset=utf-8')
    expect(await parseSubmissionPayload(req)).toEqual(FIELDS)
  })

  it('accepts an uppercase media type — header values are case-insensitive per HTTP', async () => {
    expect(await parseSubmissionPayload(post(JSON_BODY, 'APPLICATION/JSON'))).toEqual(FIELDS)
  })

  it('accepts JSON with no Content-Type at all', async () => {
    expect(await parseSubmissionPayload(post(JSON_BODY))).toEqual(FIELDS)
  })

  it('accepts JSON mislabelled as text/plain', async () => {
    expect(await parseSubmissionPayload(post(JSON_BODY, 'text/plain'))).toEqual(FIELDS)
  })

  it("accepts JSON mislabelled as urlencoded — curl -d's default, and the case that used to be accepted as one garbage key", async () => {
    const req = post(JSON_BODY, 'application/x-www-form-urlencoded')
    expect(await parseSubmissionPayload(req)).toEqual(FIELDS)
  })
})

describe('parseSubmissionPayload — form encodings', () => {
  it('reads a genuine urlencoded body', async () => {
    const body = 'Organisation+name=Bradford+Youth+Trust&Amount+requested=25000'
    expect(await parseSubmissionPayload(post(body, 'application/x-www-form-urlencoded'))).toEqual(
      FIELDS,
    )
  })

  it('reads multipart, which needs its header for the boundary', async () => {
    const form = new FormData()
    for (const [k, v] of Object.entries(FIELDS)) form.set(k, v)
    const req = new Request('https://custodian.fund/api/apply', { method: 'POST', body: form })
    expect(await parseSubmissionPayload(req)).toEqual(FIELDS)
  })
})

describe('parseSubmissionPayload — rejections', () => {
  const rejected: Array<[string, BodyInit, string | undefined]> = [
    ['an empty body', '', 'application/json'],
    ['whitespace only', '   \n ', undefined],
    ['an empty JSON object', '{}', 'application/json'],
    ['a JSON array', '[{"Organisation name":"x"}]', 'application/json'],
    ['a JSON string', '"hello"', 'application/json'],
    ['malformed JSON', '{"Organisation name":', 'application/json'],
    // Without the leading-brace rule this decodes to one key named after the whole body.
    ['malformed JSON labelled urlencoded', '{"a":1', 'application/x-www-form-urlencoded'],
    // Without the `=` rule these do the same.
    ['a plain text body', 'please fund us', 'text/plain'],
    ['an XML document', '<application><org>x</org></application>', 'application/xml'],
  ]

  for (const [name, body, contentType] of rejected) {
    it(`returns null for ${name}`, async () => {
      expect(await parseSubmissionPayload(post(body, contentType))).toBeNull()
    })
  }

  it('returns null for multipart whose boundary does not match the body', async () => {
    const req = post('--nonsense\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n', 'multipart/form-data; boundary=absent')
    expect(await parseSubmissionPayload(req)).toBeNull()
  })
})
