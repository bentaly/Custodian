// ─── Field mapping: AI fallback orchestrator ─────────────────────────────────
//
// One structured-output call proposing source keys for the unresolved required
// fields. Mirrors the Custodian-score runner's contract: it NEVER throws — not
// configured, nothing to map, or a model error all yield an empty proposal map,
// so the affected fields simply stay unresolved and the ingest goes to review.

import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { FieldMappingOutputSchema, type FieldMappingOutput } from '../../lib/fieldMapping/schema'
import {
  buildSystemPrompt,
  buildUserPrompt,
  type FieldMappingPromptInput,
} from '../../lib/fieldMapping/prompt'
import { CANONICAL_KEYS, type CanonicalFieldKey, type ProposalMap } from '../../lib/fieldMapping'
import { getAnthropic, isAnthropicConfigured } from '../custodianScore/client'

// Same model as scoring — a bounded, structured matching task well within Sonnet.
export const MAPPING_MODEL = 'claude-sonnet-4-6'

export type FieldMappingAssessor = (input: FieldMappingPromptInput) => Promise<FieldMappingOutput>

export interface RunFieldMappingOptions {
  assess?: FieldMappingAssessor
}

export const liveAssessor: FieldMappingAssessor = async (input) => {
  const message = await getAnthropic().messages.parse({
    model: MAPPING_MODEL,
    max_tokens: 2000,
    system: [
      {
        type: 'text',
        text: buildSystemPrompt(),
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
    output_config: { format: zodOutputFormat(FieldMappingOutputSchema) },
  })
  if (!message.parsed_output) {
    throw new Error(`model returned no parsed output (stop_reason: ${message.stop_reason})`)
  }
  return message.parsed_output
}

const CANONICAL_KEY_SET = new Set<string>(CANONICAL_KEYS)

export async function runFieldMapping(
  input: FieldMappingPromptInput,
  opts: RunFieldMappingOptions = {},
): Promise<ProposalMap> {
  if (input.fields.length === 0) return {}
  if (!opts.assess && !isAnthropicConfigured()) return {}

  const assess = opts.assess ?? liveAssessor
  try {
    const output = await assess(input)
    const map: ProposalMap = {}
    for (const p of output.proposals) {
      if (!CANONICAL_KEY_SET.has(p.canonicalField)) continue
      map[p.canonicalField as CanonicalFieldKey] = {
        sourceKey: p.sourceKey,
        confidence: p.confidence,
      }
    }
    return map
  } catch {
    return {}
  }
}
