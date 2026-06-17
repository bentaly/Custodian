import { describe, it, expect } from 'vitest'
import { runFieldMapping, type FieldMappingAssessor } from './run'
import type { FieldMappingPromptInput } from '../../lib/fieldMapping/prompt'

const fields: FieldMappingPromptInput['fields'] = [
  { key: 'organisationName', label: 'Organisation name', description: 'name' },
  { key: 'amountRequested', label: 'Amount requested', description: 'amount' },
]
const payload = [
  { key: 'org_name', value: 'Acme' },
  { key: 'grant_amount', value: '£10,000' },
]

describe('runFieldMapping', () => {
  it('returns empty when there are no fields to map (no model call)', async () => {
    expect(await runFieldMapping({ fields: [], payload })).toEqual({})
  })

  it('maps proposals from the assessor into a proposal map', async () => {
    const assess: FieldMappingAssessor = async () => ({
      proposals: [
        { canonicalField: 'organisationName', sourceKey: 'org_name', confidence: 0.95 },
        { canonicalField: 'amountRequested', sourceKey: 'grant_amount', confidence: 0.7 },
      ],
    })
    const r = await runFieldMapping({ fields, payload }, { assess })
    expect(r.organisationName).toEqual({ sourceKey: 'org_name', confidence: 0.95 })
    expect(r.amountRequested).toEqual({ sourceKey: 'grant_amount', confidence: 0.7 })
  })

  it('ignores proposals for unknown canonical keys', async () => {
    const assess: FieldMappingAssessor = async () => ({
      proposals: [
        { canonicalField: 'not_a_field', sourceKey: 'x', confidence: 0.99 },
        { canonicalField: 'organisationName', sourceKey: 'org_name', confidence: 0.9 },
      ],
    })
    const r = await runFieldMapping({ fields, payload }, { assess })
    expect(Object.keys(r)).toEqual(['organisationName'])
  })

  it('never throws — a model error yields an empty map', async () => {
    const assess: FieldMappingAssessor = async () => {
      throw new Error('boom')
    }
    expect(await runFieldMapping({ fields, payload }, { assess })).toEqual({})
  })

  it('preserves null sourceKey proposals', async () => {
    const assess: FieldMappingAssessor = async () => ({
      proposals: [{ canonicalField: 'organisationName', sourceKey: null, confidence: 0.1 }],
    })
    const r = await runFieldMapping({ fields, payload }, { assess })
    expect(r.organisationName).toEqual({ sourceKey: null, confidence: 0.1 })
  })
})
