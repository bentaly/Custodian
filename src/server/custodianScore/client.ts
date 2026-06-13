// ─── Anthropic client (lazy) ──────────────────────────────────────────────────
//
// Lazy so the module can be imported without throwing on a missing API key —
// the key is only read the first time scoring actually runs. Mirrors the
// pattern in src/server/auth.ts and prevents Cloudflare Workers' esbuild module
// from being permanently poisoned if the secret is absent on first load.

import Anthropic from '@anthropic-ai/sdk'

let _client: Anthropic | undefined

/** True when an Anthropic API key is configured in the environment. */
export function isAnthropicConfigured(): boolean {
  return Boolean(process.env['ANTHROPIC_API_KEY'])
}

export function getAnthropic(): Anthropic {
  if (!_client) {
    const apiKey = process.env['ANTHROPIC_API_KEY']
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required')
    _client = new Anthropic({ apiKey })
  }
  return _client
}

// The model used for application scoring. Sonnet 4.6 is the cost/quality sweet
// spot for this bounded, rubric-driven judgement task — Opus-class judgement at
// ~60% of the cost, and it supports the same API surface (adaptive thinking +
// structured outputs) we use in run.ts. Drop to 'claude-haiku-4-5' if scoring
// volume makes cost bite — but note Haiku doesn't support the `effort` param and
// uses the older budget_tokens thinking style, so it's not a pure drop-in.
export const SCORING_MODEL = 'claude-sonnet-4-6'
