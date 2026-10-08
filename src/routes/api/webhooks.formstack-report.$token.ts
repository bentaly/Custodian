import { createFileRoute } from '@tanstack/react-router'
import { receiveReport, receiveWebhook } from '../../server/webhookIntake'

// Formstack posts a GRANT REPORT form here: the report-side twin of
// `/api/webhooks/formstack/<token>`, as the Typeform pair are. Same token, the address
// says which kind of form it is.

export const Route = createFileRoute('/api/webhooks/formstack-report/$token')({
  server: {
    handlers: {
      POST: ({ request, params }: { request: Request; params: { token: string } }) =>
        receiveWebhook(request, params.token, receiveReport),
    },
  },
} as any)
