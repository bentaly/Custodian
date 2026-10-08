import { createFileRoute } from '@tanstack/react-router'
import { receiveApplication, receiveWebhook } from '../../server/webhookIntake'

// Formstack posts an APPLICATION form here. Its Webhook action takes a URL and offers
// no custom headers, so the credential travels in the path exactly as Typeform's does,
// with the same `cust_wh_…` token. The delivery is read by `submissionEnvelope/
// formstack.ts`, which drops the `HandshakeKey` Formstack echoes in the body.
//
// A Formstack delivery names its form only by a numeric `FormID`, so the programme
// comes from the form itself: a question, or a hidden field defaulting to the
// programme's name. See the Submission guide.

export const Route = createFileRoute('/api/webhooks/formstack/$token')({
  server: {
    handlers: {
      POST: ({ request, params }: { request: Request; params: { token: string } }) =>
        receiveWebhook(request, params.token, receiveApplication),
    },
  },
} as any)
