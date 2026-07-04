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
import { CANONICAL_KEYS } from '../../lib/fieldMapping'
import type { FieldProposal } from '../../lib/fieldMapping/types'
import { getAnthropic, isAnthropicConfigured } from '../custodianScore/client'

// Same model as scoring — a bounded, structured matching task well within Sonnet.
export const MAPPING_MODEL = 'claude-sonnet-4-6'

export type FieldMappingAssessor = (input: FieldMappingPromptInput) => Promise<FieldMappingOutput>

export interface RunFieldMappingOptions {
  assess?: FieldMappingAssessor
  /** The canonical vocabulary proposals may target. Defaults to the application fields. */
  allowedKeys?: ReadonlySet<string>
  /** Which form the payload came from — only flavours the (cached) system prompt. */
  formKind?: 'grant application' | 'grant report'
}

export function makeLiveAssessor(
  formKind: 'grant application' | 'grant report',
): FieldMappingAssessor {
  return async (input) => {
    const message = await getAnthropic().messages.parse({
      model: MAPPING_MODEL,
      max_tokens: 2000,
      system: [
        {
          type: 'text',
          text: buildSystemPrompt(formKind),
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
}

export const liveAssessor: FieldMappingAssessor = makeLiveAssessor('grant application')

const CANONICAL_KEY_SET = new Set<string>(CANONICAL_KEYS)

export async function runFieldMapping(
  input: FieldMappingPromptInput,
  opts: RunFieldMappingOptions = {},
): Promise<Record<string, FieldProposal>> {
  if (input.fields.length === 0) return {}
  if (!opts.assess && !isAnthropicConfigured()) return {}

  const keySet = opts.allowedKeys ?? CANONICAL_KEY_SET
  const assess = opts.assess ?? makeLiveAssessor(opts.formKind ?? 'grant application')
  try {
    const output = await assess(input)
    const map: Record<string, FieldProposal> = {}
    for (const p of output.proposals) {
      if (!keySet.has(p.canonicalField)) continue
      map[p.canonicalField] = {
        sourceKey: p.sourceKey,
        confidence: p.confidence,
      }
    }
    return map
  } catch {
    return {}
  }
}
