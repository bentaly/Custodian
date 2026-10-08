import { createFileRoute } from '@tanstack/react-router'
import { receiveApplication, receiveWebhook } from '../../server/webhookIntake'

// Typeform posts here directly — no integration builder in between.
//
// This is `/api/apply` with one difference, and the difference is not ours: Typeform
// lets you set a webhook URL and nothing else. No custom headers, so no
// `Authorization: Bearer`. The credential therefore travels in the path, which is why
// it is a token of its own kind (`cust_wh_…`) rather than the foundation's API key —
// see `apiKeys.ts`. Everything after authentication is identical, because the envelope
// is already flat by the time it gets here: `parseSubmissionPayload` recognises the
// shape and hands on the same `{ field → value }` object a foundation would have
// posted by hand.
//
// The door (rate limits, token, decode, 200 not 202, no CORS) is shared with every
// platform's route: see `server/webhookIntake.ts`.

export const Route = createFileRoute('/api/webhooks/typeform/$token')({
  server: {
    handlers: {
      POST: ({ request, params }: { request: Request; params: { token: string } }) =>
        receiveWebhook(request, params.token, receiveApplication),
    },
  },
} as any)
